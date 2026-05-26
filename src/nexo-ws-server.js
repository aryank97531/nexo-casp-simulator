/**
 * nexo CASP v8.0 — External Protocol WebSocket Server
 *
 * A real nexo-over-WebSocket endpoint that accepts raw XML messages from
 * external POS clients (or test tools like Postman/wscat) and responds
 * with v8.0-compliant XML responses via the POI simulator.
 *
 * Listens on a configurable port (default 9000), separate from the GUI.
 * All traffic is forwarded to the GUI clients for real-time inspection.
 */
const { WebSocketServer } = require('ws');
const {
  MessageFunction, ServiceContentNames, DefaultConfig, PROTOCOL_VERSION,
} = require('./nexo/constants');
const { MessageValidator } = require('./nexo/validator');
const { isoDateTime, genExchangeId, xmlBuilder } = require('./nexo/protocol');
const {
  parseXml,
  getRootKey,
  detectMessageFunction,
  extractExchangeId,
} = require('./xml-wire');

class NexoWebSocketServer {
  /**
   * @param {object} opts
   * @param {number} opts.port              - Port to listen on (default 9000)
   * @param {object} opts.simulator         - Shared POISimulator instance
   * @param {object} opts.store             - Shared TransactionStore instance
   * @param {Function} opts.broadcastToGUI  - Function to relay events to the GUI clients
   * @param {object} opts.config            - Shared config reference getter
   */
  constructor(opts = {}) {
    this.port = opts.port || 9000;
    this.simulator = opts.simulator;
    this.store = opts.store;
    this.broadcastToGUI = opts.broadcastToGUI || (() => {});
    this.getConfig = opts.getConfig || (() => ({ ...DefaultConfig }));
    this.validator = new MessageValidator();

    this.clients = new Map(); // ws -> { id, remoteAddr, connectedAt, messageCount }
    this.wss = null;
    this.clientIdCounter = 0;
    this.running = false;
  }

  /** Start listening */
  start() {
    this.wss = new WebSocketServer({ port: this.port });
    this.running = true;

    this.wss.on('listening', () => {
      console.log(`  [NEXO-WS] Protocol server listening on ws://localhost:${this.port}`);
      this.broadcastToGUI({
        type: 'nexoServerStatus',
        status: 'listening',
        port: this.port,
        clientCount: 0,
      });
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = ++this.clientIdCounter;
      const remoteAddr = req.socket.remoteAddress || 'unknown';
      const clientInfo = {
        id: clientId,
        remoteAddr,
        connectedAt: new Date().toISOString(),
        messageCount: 0,
      };
      this.clients.set(ws, clientInfo);

      console.log(`  [NEXO-WS] Client #${clientId} connected from ${remoteAddr} (${this.clients.size} total)`);

      this.broadcastToGUI({
        type: 'nexoClientConnected',
        client: clientInfo,
        clientCount: this.clients.size,
      });

      // ─── Handle incoming raw XML messages ───
      ws.on('message', async (data) => {
        const raw = data.toString();
        clientInfo.messageCount++;

        try {
          await this._handleIncomingMessage(ws, clientInfo, raw);
        } catch (err) {
          console.error(`  [NEXO-WS] Error processing message from client #${clientId}:`, err.message);
          // Send a MessageRejection
          const rejection = this._buildRejection(err.message);
          ws.send(rejection.xml);

          this._logToGUI('poi-to-sale', 'SSRR', 'Message Rejection', rejection.xml, rejection.json, null, {
            source: 'external',
            clientId,
          });
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`  [NEXO-WS] Client #${clientId} disconnected (code: ${code})`);
        this.clients.delete(ws);
        this.broadcastToGUI({
          type: 'nexoClientDisconnected',
          clientId,
          clientCount: this.clients.size,
        });
      });

      ws.on('error', (err) => {
        console.error(`  [NEXO-WS] Client #${clientId} error:`, err.message);
      });
    });

    this.wss.on('error', (err) => {
      console.error(`  [NEXO-WS] Server error:`, err.message);
      this.broadcastToGUI({
        type: 'nexoServerStatus',
        status: 'error',
        error: err.message,
      });
    });
  }

  /** Stop the server */
  stop() {
    if (this.wss) {
      for (const [ws] of this.clients) {
        ws.close(1001, 'Server shutting down');
      }
      this.wss.close();
      this.running = false;
      this.broadcastToGUI({
        type: 'nexoServerStatus',
        status: 'stopped',
        port: this.port,
      });
    }
  }

  /** Get current server status */
  getStatus() {
    return {
      running: this.running,
      port: this.port,
      clientCount: this.clients.size,
      clients: Array.from(this.clients.values()),
    };
  }

  // ═══════════════════════════════════════════════════
  // Message Processing Pipeline
  // ═══════════════════════════════════════════════════

  async _handleIncomingMessage(ws, clientInfo, rawXml) {
    // 1. Parse XML → JSON
    let parsed;
    try {
      parsed = parseXml(rawXml);
    } catch (parseErr) {
      throw new Error(`XML parse error: ${parseErr.message}`);
    }

    // 2. Detect message type from root element
    const rootKey = getRootKey(parsed);
    const msgFunction = detectMessageFunction(parsed, rootKey);

    if (!msgFunction) {
      throw new Error(`Cannot determine MessageFunction from root element: ${rootKey}`);
    }

    // 3. Extract exchangeId from header
    const exchangeId = extractExchangeId(parsed, rootKey) || genExchangeId();

    // 4. Validate the incoming message
    const validation = this.validator.validate(msgFunction, parsed);

    // 5. Log incoming request to GUI
    this._logToGUI('sale-to-poi', msgFunction,
      ServiceContentNames[msgFunction] || msgFunction,
      rawXml, parsed, validation, {
        source: 'external',
        clientId: clientInfo.id,
        clientAddr: clientInfo.remoteAddr,
      });

    // 6. Process through POI simulator
    const result = await this.simulator.processRequest(msgFunction, parsed, exchangeId);

    // 7. Send device steps to GUI (visual feedback) but NOT to the external client
    if (result.steps && result.steps.length > 0) {
      for (const step of result.steps) {
        await this._delay(step.delay || 300);

        this._logToGUI('poi-to-sale', step.msgFunction,
          ServiceContentNames[step.msgFunction] || step.msgFunction,
          step.message.xml, step.message.json, null, {
            source: 'internal-device',
            clientId: clientInfo.id,
            isDeviceMessage: true,
          });

        this.broadcastToGUI({
          type: 'pinpadDisplay',
          text: step.displayText,
          msgFunction: step.msgFunction,
          requiresInput: step.requiresInput || false,
        });

        if (step.requiresInput) {
          await this._delay(1500); // Simulate PIN entry
        }
      }
    }

    // 8. Simulate processing delay
    const config = this.getConfig();
    await this._delay(config.responseDelay || 800);

    // 9. Send XML response back to external client
    if (result.response && result.response.xml) {
      ws.send(result.response.xml);

      this._logToGUI('poi-to-sale', result.response.msgFunction,
        ServiceContentNames[result.response.msgFunction] || result.response.msgFunction,
        result.response.xml, result.response.json, null, {
          source: 'external',
          clientId: clientInfo.id,
        });

      this.broadcastToGUI({
        type: 'pinpadDisplay',
        text: result.response.displayText || '',
        status: result.response.status || 'info',
      });

      // Update login state in GUI
      if (result.response.displayText === 'LOGIN SUCCESSFUL') {
        this.broadcastToGUI({ type: 'loginStateChanged', loggedIn: true });
      } else if (result.response.displayText === 'LOGOUT OK') {
        this.broadcastToGUI({ type: 'loginStateChanged', loggedIn: false });
      }

      // Log transaction
      if (['FSPP', 'FSRP', 'FSIP'].includes(result.response.msgFunction)) {
        const txEntry = this.store.addTransaction({
          action: this._actionFromMsgFunction(msgFunction),
          amount: this._extractAmountFromParsed(parsed),
          currency: config.currency,
          status: result.response.status,
          displayText: result.response.displayText,
          exchangeId,
          card: this.simulator.selectedCard.brand,
          source: 'external',
          clientId: clientInfo.id,
        });

        this.broadcastToGUI({
          type: 'transactionLogged',
          transactions: this.store.getTransactions(20),
        });
      }
    }

    // 10. Send receipt step to GUI
    if (result.receiptStep) {
      await this._delay(result.receiptStep.delay || 300);
      this._logToGUI('poi-to-sale', result.receiptStep.msgFunction || 'DPRQ',
        'Print Request',
        result.receiptStep.message.xml, result.receiptStep.message.json, null, {
          source: 'internal-device',
          clientId: clientInfo.id,
          isDeviceMessage: true,
        });
      if (result.receiptStep.message.receipt) {
        this.broadcastToGUI({ type: 'receipt', text: result.receiptStep.message.receipt });
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════

  _extractAmountFromParsed(parsed) {
    try {
      const svc = parsed?.SaleToPOISvcReq?.SvcReq;
      return svc?.PmtReq?.Tx?.TtlAmt || null;
    } catch { return null; }
  }

  _actionFromMsgFunction(mf) {
    const map = {
      FSPQ: 'payment', FSRQ: 'reversal', FSIQ: 'balanceInquiry',
      FSCQ: 'reconciliation', SMIQ: 'login', SMOQ: 'logout',
      SMDQ: 'diagnosis', SSAB: 'abort', SSSQ: 'messageStatus',
    };
    return map[mf] || mf;
  }

  _buildRejection(reason) {
    const msg = {
      SaleToPOIMsgRjctn: {
        Hdr: {
          MsgFctn: 'SSRR',
          PrtcolVrsn: PROTOCOL_VERSION,
          XchgId: genExchangeId(),
          CreDtTm: isoDateTime(),
          InitgPty: { Id: this.getConfig().poiId || DefaultConfig.poiId },
          RcptPty: { Id: this.getConfig().saleId || DefaultConfig.saleId },
        },
        MsgRjctn: {
          RjctRsn: 'FMTE',
          ErrDtl: reason,
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg };
  }

  _logToGUI(direction, msgFunction, name, xml, json, validation, meta = {}) {
    const entry = this.store.addMessage({
      direction,
      msgFunction,
      name,
      xml,
      json,
      validation,
      exchangeId: meta.exchangeId,
      isDeviceMessage: meta.isDeviceMessage || false,
      source: meta.source || 'external',
      clientId: meta.clientId,
    });

    this.broadcastToGUI({
      type: 'messageLogged',
      message: entry,
      direction,
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { NexoWebSocketServer };
