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
const {
  DefaultConfig, MessageFunction, ServiceContentNames, CardProfiles,
} = require('./src/nexo/constants');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state
let config = { ...DefaultConfig };
const store = new TransactionStore();
const simulator = new POISimulator(config);
const validator = new MessageValidator();
const guiClients = new Set();

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
      config = { ...config, ...msg.config };
      Object.assign(simulator.config, config);
      broadcast({ type: 'configUpdated', config });
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

async function handleSendRequest(ws, msg) {
  const { action, params = {} } = msg;
  let request;

  switch (action) {
    case 'payment':
      request = protocol.buildPaymentRequest(config, params);
      break;
    case 'refund':
      request = protocol.buildPaymentRequest(config, {
        ...params, transactionType: 'RFND', paymentType: 'RFND',
      });
      break;
    case 'reversal':
      request = protocol.buildReversalRequest(config, params);
      break;
    case 'balanceInquiry':
      request = protocol.buildBalanceInquiryRequest(config, params);
      break;
    case 'reconciliation':
      request = protocol.buildReconciliationRequest(config, params);
      break;
    case 'login':
      request = protocol.buildLoginRequest(config, params);
      break;
    case 'logout':
      request = protocol.buildLogoutRequest(config, params);
      break;
    case 'diagnosis':
      request = protocol.buildDiagnosisRequest(config, params);
      break;
    case 'abort':
      request = protocol.buildAbortRequest(config, params);
      break;
    case 'messageStatus':
      request = protocol.buildMessageStatusRequest(config, params);
      break;
    default:
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
  });

  broadcast({ type: 'messageLogged', message: reqEntry, direction: 'sale-to-poi' });

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
      });
      broadcast({ type: 'messageLogged', message: rspEntry, direction: 'poi-to-sale' });
      broadcast({ type: 'pinpadDisplay', text: result.response.displayText || '', status: result.response.status || 'info' });

      store.addTransaction({
        action, amount: params.amount, currency: params.currency || config.currency,
        status: result.response.status, displayText: result.response.displayText,
        exchangeId: request.exchangeId, card: simulator.selectedCard.brand,
      });
      broadcast({ type: 'transactionLogged', transactions: store.getTransactions(20) });
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

// ═══════════════════════════════════════════════════
// REST API
// ═══════════════════════════════════════════════════
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => {
  config = { ...config, ...req.body };
  Object.assign(simulator.config, config);
  broadcast({ type: 'configUpdated', config });
  res.json(config);
});
app.get('/api/transactions', (req, res) => res.json(store.getTransactions()));
app.get('/api/messages', (req, res) => res.json(store.getMessages()));
app.get('/api/cards', (req, res) => res.json(CardProfiles));
app.get('/api/nexo-server', (req, res) => res.json(nexoServer.getStatus()));

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

// ═══════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
  console.log(`  ║  nexo CASP v8.0 Pinpad Simulator                    ║`);
  console.log(`  ║  GUI:      http://localhost:${PORT}                    ║`);
  console.log(`  ║  nexo WS:  ws://localhost:${NEXO_PORT}  (XML protocol)    ║`);
  console.log(`  ╚══════════════════════════════════════════════════════╝\n`);
});
