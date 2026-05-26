/**
 * nexo CASP v8.0 POS Pinpad Simulator — Server
 * Express + WebSocket (GUI) + nexo Protocol WebSocket (external clients)
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const protocol = require('./src/nexo/protocol');
const { POISimulator } = require('./src/nexo/simulator');
const { MessageValidator } = require('./src/nexo/validator');
const { TransactionStore } = require('./src/store');
const { NexoWebSocketServer } = require('./src/nexo-ws-server');
const { PhysicalTerminalBridge } = require('./src/physical-terminal-bridge');
const {
  DefaultConfig, MessageFunction, ServiceContentNames, CardProfiles, ResponseCode,
} = require('./src/nexo/constants');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, verifyClient: verifyWebSocketClient });

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Global state
let config = {
  ...DefaultConfig,
  terminalMode: process.env.TERMINAL_MODE || DefaultConfig.terminalMode,
  physicalTcpHost: process.env.PHYSICAL_TCP_HOST || DefaultConfig.physicalTcpHost,
  physicalTcpPort: parseInt(process.env.PHYSICAL_TCP_PORT || DefaultConfig.physicalTcpPort, 10),
};
const store = new TransactionStore();
const simulator = new POISimulator(config);
const validator = new MessageValidator();
const guiClients = new Set();
let terminalWasConnected = false;

// ═══════════════════════════════════════════════════
// nexo Protocol WebSocket Server (external clients)
// ═══════════════════════════════════════════════════
const NEXO_PORT = parseInt(process.env.NEXO_PORT || '9000', 10);
const nexoServer = new NexoWebSocketServer({
  port: NEXO_PORT,
  simulator,
  store,
  broadcastToGUI: (data) => broadcast(data),
  getConfig: () => config,
});
nexoServer.start();

// ═══════════════════════════════════════════════════
// Physical EFTPOS Terminal TCP Bridge
// ═══════════════════════════════════════════════════
const terminalBridge = new PhysicalTerminalBridge({
  host: config.physicalTcpHost,
  port: config.physicalTcpPort,
});
terminalBridge.on('status', (status) => {
  if (terminalWasConnected && !status.connected) {
    simulator.loggedIn = false;
    broadcast({ type: 'loginStateChanged', loggedIn: false });
  }
  terminalWasConnected = status.connected;
  broadcast({ type: 'terminalStatus', status, mode: getActiveTerminalMode() });
});
terminalBridge.on('terminalError', (err) => {
  console.error('[TERMINAL-TCP] Error:', err.message);
  broadcast({ type: 'terminalError', error: err.message, status: terminalBridge.getStatus() });
});
terminalBridge.on('errorStatus', (err) => {
  console.error('[TERMINAL-TCP] Listener error:', err.message);
  broadcast({ type: 'terminalError', error: err.message, status: terminalBridge.getStatus() });
});
terminalBridge.on('wireMessage', handleTerminalWireMessage);
terminalBridge.start();

// ═══════════════════════════════════════════════════
// GUI WebSocket handling
// ═══════════════════════════════════════════════════
wss.on('connection', (ws) => {
  guiClients.add(ws);
  console.log(`[GUI-WS] Client connected (${guiClients.size} total)`);

  // Send initial state including nexo server info
  ws.send(JSON.stringify({
    type: 'init',
    config,
    loggedIn: simulator.loggedIn,
    cardProfiles: Object.keys(CardProfiles),
    selectedCard: simulator.selectedCard,
    nexoServer: nexoServer.getStatus(),
    terminal: terminalBridge.getStatus(),
    activeTerminalMode: getActiveTerminalMode(),
  }));

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleWSMessage(ws, msg);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  ws.on('close', () => {
    guiClients.delete(ws);
    console.log(`[GUI-WS] Client disconnected (${guiClients.size} total)`);
  });
});

async function handleWSMessage(ws, msg) {
  switch (msg.type) {
    case 'sendRequest':
      await handleSendRequest(ws, msg);
      break;
    case 'updateConfig':
      updateConfig(msg.config || {});
      Object.assign(simulator.config, config);
      broadcast({ type: 'configUpdated', config });
      broadcast({ type: 'terminalStatus', status: terminalBridge.getStatus(), mode: getActiveTerminalMode() });
      break;
    case 'selectCard':
      simulator.setCard(msg.cardProfile);
      broadcast({ type: 'cardSelected', card: simulator.selectedCard });
      break;
    case 'setForceDecline':
      simulator.forceDecline = msg.value;
      break;
    case 'pinEntry':
      broadcast({ type: 'pinEntered' });
      break;
    case 'clearHistory':
      store.clear();
      broadcast({ type: 'historyCleared' });
      break;
    case 'runScenario':
      await runScenario(ws, msg.scenario);
      break;
    case 'getNexoStatus':
      ws.send(JSON.stringify({
        type: 'nexoServerStatus',
        ...nexoServer.getStatus(),
      }));
      break;
    case 'sendRawXml':
      await handleSendRawXml(ws, msg);
      break;
    default:
      ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${msg.type}` }));
  }
}

// ─── Send raw XML directly to the nexo WS server for testing ───
async function handleSendRawXml(ws, msg) {
  const { xml } = msg;
  if (!xml || !xml.trim()) {
    ws.send(JSON.stringify({ type: 'error', error: 'Empty XML payload' }));
    return;
  }

  // Create a local WS client connection to the nexo server for this test
  const { WebSocket: WsClient } = require('ws');
  const testClient = new WsClient(`ws://localhost:${NEXO_PORT}`);

  testClient.on('open', () => {
    testClient.send(xml);
  });

  testClient.on('message', (data) => {
    const responseXml = data.toString();
    broadcast({
      type: 'rawXmlResponse',
      xml: responseXml,
    });
    testClient.close();
  });

  testClient.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', error: `Connection failed: ${err.message}` }));
  });
}

function buildRequest(action, params = {}) {
  switch (action) {
    case 'payment':
      return protocol.buildPaymentRequest(config, params);
    case 'refund':
      return protocol.buildPaymentRequest(config, {
        ...params, transactionType: 'RFND', paymentType: 'RFND',
      });
    case 'reversal':
      return protocol.buildReversalRequest(config, params);
    case 'balanceInquiry':
      return protocol.buildBalanceInquiryRequest(config, params);
    case 'reconciliation':
      return protocol.buildReconciliationRequest(config, params);
    case 'login':
      return protocol.buildLoginRequest(config, params);
    case 'logout':
      return protocol.buildLogoutRequest(config, params);
    case 'diagnosis':
      return protocol.buildDiagnosisRequest(config, params);
    case 'abort':
      return protocol.buildAbortRequest(config, params);
    case 'messageStatus':
      return protocol.buildMessageStatusRequest(config, params);
    default:
      return null;
  }
}

async function handleSendRequest(ws, msg) {
  const { action, params = {} } = msg;
  const request = buildRequest(action, params);

  if (!request) {
    ws.send(JSON.stringify({ type: 'error', error: `Unknown action: ${action}` }));
    return;
  }

  const validation = validator.validate(request.msgFunction, request.json);

  const reqEntry = store.addMessage({
    direction: 'sale-to-poi',
    msgFunction: request.msgFunction,
    name: ServiceContentNames[request.msgFunction] || request.msgFunction,
    xml: request.xml,
    json: request.json,
    validation,
    exchangeId: request.exchangeId,
    source: shouldUsePhysicalTerminal() ? 'physical' : 'simulator',
  });

  broadcast({ type: 'messageLogged', message: reqEntry, direction: 'sale-to-poi' });

  if (shouldUsePhysicalTerminal()) {
    try {
      terminalBridge.send(request.xml);
      broadcast({ type: 'pinpadDisplay', text: 'SENT TO TERMINAL', status: 'info' });
      return;
    } catch (err) {
      broadcast({ type: 'terminalError', error: err.message, status: terminalBridge.getStatus() });
      if (config.terminalMode === 'physical') {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
        return;
      }
    }
  }

  if (config.autoRespond) {
    const result = await simulator.processRequest(
      request.msgFunction, request.json, request.exchangeId
    );

    if (result.steps && result.steps.length > 0) {
      for (const step of result.steps) {
        await delay(step.delay || 500);
        const stepEntry = store.addMessage({
          direction: 'poi-to-sale',
          msgFunction: step.msgFunction,
          name: ServiceContentNames[step.msgFunction] || step.msgFunction,
          xml: step.message.xml, json: step.message.json,
          exchangeId: request.exchangeId, isDeviceMessage: true,
        });
        broadcast({ type: 'messageLogged', message: stepEntry, direction: 'poi-to-sale' });
        broadcast({
          type: 'pinpadDisplay', text: step.displayText,
          msgFunction: step.msgFunction, requiresInput: step.requiresInput || false,
        });
        if (step.requiresInput) await delay(2000);
      }
    }

    await delay(config.responseDelay || 800);

    if (result.response && result.response.xml) {
      const rspEntry = store.addMessage({
        direction: 'poi-to-sale',
        msgFunction: result.response.msgFunction,
        name: ServiceContentNames[result.response.msgFunction] || result.response.msgFunction,
        xml: result.response.xml, json: result.response.json,
        exchangeId: request.exchangeId,
        source: 'simulator',
      });
      broadcast({ type: 'messageLogged', message: rspEntry, direction: 'poi-to-sale' });
      broadcast({ type: 'pinpadDisplay', text: result.response.displayText || '', status: result.response.status || 'info' });

      if ([MessageFunction.FSPP, MessageFunction.FSRP, MessageFunction.FSIP, MessageFunction.FSCP].includes(result.response.msgFunction)) {
        store.addTransaction({
          action, amount: params.amount, currency: params.currency || config.currency,
          status: result.response.status, displayText: result.response.displayText,
          exchangeId: request.exchangeId, card: simulator.selectedCard.brand,
        });
        broadcast({ type: 'transactionLogged', transactions: store.getTransactions(20) });
      }
    }

    if (result.receiptStep) {
      await delay(result.receiptStep.delay || 300);
      const receiptEntry = store.addMessage({
        direction: 'poi-to-sale',
        msgFunction: result.receiptStep.msgFunction || MessageFunction.DPRQ,
        name: 'Print Request',
        xml: result.receiptStep.message.xml, json: result.receiptStep.message.json,
        exchangeId: request.exchangeId, isDeviceMessage: true,
      });
      broadcast({ type: 'messageLogged', message: receiptEntry, direction: 'poi-to-sale' });
      if (result.receiptStep.message.receipt) {
        broadcast({ type: 'receipt', text: result.receiptStep.message.receipt });
      }
    }
  }
}

// ═══════════════════════════════════════════════════
// Scenario runner
// ═══════════════════════════════════════════════════
async function runScenario(ws, scenario) {
  broadcast({ type: 'scenarioStarted', scenario });
  const scenarios = {
    'happy-payment': [
      { action: 'login', params: {} },
      { action: 'payment', params: { amount: '49.95' }, wait: 1000 },
      { action: 'logout', params: {}, wait: 1000 },
    ],
    'payment-declined': [
      { action: 'login', params: {} },
      { action: 'payment', params: { amount: '999999.99' }, wait: 1000 },
      { action: 'logout', params: {}, wait: 1000 },
    ],
    'refund-flow': [
      { action: 'login', params: {} },
      { action: 'refund', params: { amount: '25.00' }, wait: 1000 },
      { action: 'logout', params: {}, wait: 1000 },
    ],
    'reconciliation': [
      { action: 'login', params: {} },
      { action: 'payment', params: { amount: '100.00' }, wait: 1000 },
      { action: 'payment', params: { amount: '55.50' }, wait: 1000 },
      { action: 'reconciliation', params: {}, wait: 1000 },
      { action: 'logout', params: {}, wait: 1000 },
    ],
    'diagnosis': [
      { action: 'login', params: {} },
      { action: 'diagnosis', params: {}, wait: 1000 },
      { action: 'logout', params: {}, wait: 1000 },
    ],
    'reversal': [
      { action: 'login', params: {} },
      { action: 'payment', params: { amount: '75.00' }, wait: 1000 },
      { action: 'reversal', params: { amount: '75.00', reversalReason: 'MERC' }, wait: 1000 },
      { action: 'logout', params: {}, wait: 1000 },
    ],
    'multi-payment': [
      { action: 'login', params: {} },
      { action: 'payment', params: { amount: '10.00' }, wait: 800 },
      { action: 'payment', params: { amount: '25.50' }, wait: 800 },
      { action: 'payment', params: { amount: '99.99' }, wait: 800 },
      { action: 'refund', params: { amount: '25.50' }, wait: 800 },
      { action: 'reconciliation', params: {}, wait: 1000 },
      { action: 'logout', params: {}, wait: 500 },
    ],
  };
  const steps = scenarios[scenario];
  if (!steps) { ws.send(JSON.stringify({ type: 'error', error: `Unknown scenario: ${scenario}` })); return; }
  for (const step of steps) {
    if (step.wait) await delay(step.wait);
    await handleSendRequest(ws, { type: 'sendRequest', action: step.action, params: step.params });
    await delay(3000);
  }
  broadcast({ type: 'scenarioCompleted', scenario });
}

function handleTerminalWireMessage(message) {
  const entry = store.addMessage({
    direction: message.direction,
    msgFunction: message.msgFunction,
    name: ServiceContentNames[message.msgFunction] || message.msgFunction,
    xml: message.xml,
    json: message.json,
    validation: message.validation,
    exchangeId: message.exchangeId,
    source: 'physical',
    remoteAddress: message.remoteAddress,
  });

  broadcast({ type: 'messageLogged', message: entry, direction: message.direction });
  broadcast({ type: 'terminalWireMessage', message: entry });
  broadcast({ type: 'pinpadDisplay', text: displayTextForTerminalMessage(message), status: statusForTerminalMessage(message) });

  if (message.msgFunction === MessageFunction.SMIP) {
    simulator.loggedIn = responseSucceeded(message.json);
    broadcast({ type: 'loginStateChanged', loggedIn: simulator.loggedIn });
  } else if (message.msgFunction === MessageFunction.SMOP && responseSucceeded(message.json)) {
    simulator.loggedIn = false;
    broadcast({ type: 'loginStateChanged', loggedIn: false });
  }

  if ([MessageFunction.FSPP, MessageFunction.FSRP, MessageFunction.FSIP].includes(message.msgFunction)) {
    store.addTransaction({
      action: actionFromMsgFunction(message.msgFunction),
      amount: extractAmountFromResponse(message.json),
      currency: config.currency,
      status: statusForTerminalMessage(message),
      displayText: displayTextForTerminalMessage(message),
      exchangeId: message.exchangeId,
      card: 'Physical terminal',
      source: 'physical',
    });
    broadcast({ type: 'transactionLogged', transactions: store.getTransactions(20) });
  }
}

// ═══════════════════════════════════════════════════
// REST API
// ═══════════════════════════════════════════════════
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => {
  updateConfig(req.body || {});
  Object.assign(simulator.config, config);
  broadcast({ type: 'configUpdated', config });
  broadcast({ type: 'terminalStatus', status: terminalBridge.getStatus(), mode: getActiveTerminalMode() });
  res.json(config);
});
app.get('/api/transactions', (req, res) => res.json(store.getTransactions()));
app.get('/api/messages', (req, res) => res.json(store.getMessages()));
app.get('/api/cards', (req, res) => res.json(CardProfiles));
app.get('/api/nexo-server', (req, res) => res.json(nexoServer.getStatus()));
app.get('/api/terminal', (req, res) => res.json({ ...terminalBridge.getStatus(), mode: getActiveTerminalMode() }));

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════
function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of guiClients) {
    if (client.readyState === 1) client.send(payload);
  }
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function updateConfig(patch) {
  const allowed = new Set([
    'saleId', 'poiId', 'merchantName', 'merchantCategoryCode', 'merchantCountry',
    'responseDelay', 'autoRespond', 'terminalMode', 'physicalTcpHost', 'physicalTcpPort',
  ]);
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue;
    next[key] = value;
  }
  if (next.terminalMode && !['auto', 'virtual', 'physical'].includes(next.terminalMode)) {
    delete next.terminalMode;
  }
  if (next.responseDelay !== undefined) {
    next.responseDelay = Math.max(0, Math.min(30000, parseInt(next.responseDelay, 10) || 0));
  }
  if (next.physicalTcpPort !== undefined) {
    next.physicalTcpPort = Math.max(1, Math.min(65535, parseInt(next.physicalTcpPort, 10) || config.physicalTcpPort));
  }
  config = { ...config, ...next };
  if (next.physicalTcpHost || next.physicalTcpPort) {
    terminalBridge.configure({ host: config.physicalTcpHost, port: config.physicalTcpPort });
  }
}

function shouldUsePhysicalTerminal() {
  if (config.terminalMode === 'virtual') return false;
  if (config.terminalMode === 'physical') return terminalBridge.isConnected();
  return terminalBridge.isConnected();
}

function getActiveTerminalMode() {
  if (config.terminalMode === 'virtual') return 'virtual';
  if (terminalBridge.isConnected() && config.terminalMode !== 'virtual') return 'physical';
  return 'virtual';
}

function responseSucceeded(json) {
  return findResponse(json)?.Rspn === ResponseCode.SUCC;
}

function statusForTerminalMessage(message) {
  const rspn = findResponse(message.json);
  if (!rspn) return 'info';
  return rspn.Rspn === ResponseCode.SUCC ? 'success' : 'declined';
}

function displayTextForTerminalMessage(message) {
  const rspn = findResponse(message.json);
  if (message.msgFunction === MessageFunction.SMIP) return rspn?.Rspn === ResponseCode.SUCC ? 'TERMINAL LOGIN OK' : 'TERMINAL LOGIN FAILED';
  if (message.msgFunction === MessageFunction.SMOP) return rspn?.Rspn === ResponseCode.SUCC ? 'TERMINAL LOGOUT OK' : 'TERMINAL LOGOUT FAILED';
  if (message.msgFunction === MessageFunction.FSPP) return rspn?.Rspn === ResponseCode.SUCC ? 'TERMINAL APPROVED' : 'TERMINAL DECLINED';
  return `TERMINAL ${message.msgFunction || 'MESSAGE'}`;
}

function findResponse(json) {
  return json?.SaleToPOISvcRspn?.SvcRspn?.Rspn
    || json?.SaleToPOISsnMgmtRspn?.SsnMgmtRspn?.Rspn
    || json?.SaleToPOIRcncltnRspn?.Rspn
    || json?.SaleToPOIMsgStsRspn?.MsgStsRspn?.Rspn
    || null;
}

function extractAmountFromResponse(json) {
  return json?.SaleToPOISvcRspn?.SvcRspn?.PmtRspn?.Tx?.TtlAmt
    || json?.SaleToPOISvcRspn?.SvcRspn?.RvslRspn?.RvsdAmt
    || null;
}

function actionFromMsgFunction(msgFunction) {
  const map = {
    [MessageFunction.FSPP]: 'payment',
    [MessageFunction.FSRP]: 'reversal',
    [MessageFunction.FSIP]: 'balanceInquiry',
  };
  return map[msgFunction] || msgFunction;
}

function verifyWebSocketClient(info) {
  const origin = info.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = info.req.headers.host;
    return originUrl.host === host || ['localhost', '127.0.0.1', '::1'].includes(originUrl.hostname);
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
  console.log(`  ║  nexo CASP v8.0 Pinpad Simulator                    ║`);
  console.log(`  ║  GUI:      http://localhost:${PORT}                    ║`);
  console.log(`  ║  nexo WS:  ws://localhost:${NEXO_PORT}  (XML protocol)    ║`);
  console.log(`  ║  EFTPOS TCP: ${config.physicalTcpHost}:${config.physicalTcpPort}                 ║`);
  console.log(`  ╚══════════════════════════════════════════════════════╝\n`);
});
