/**
 * TCP bridge for a physical EFTPOS terminal that connects to this app.
 */
const net = require('net');
const EventEmitter = require('events');
const {
  parseXml,
  getRootKey,
  detectMessageFunction,
  extractExchangeId,
  extractXmlDocuments,
} = require('./xml-wire');
const { MessageValidator } = require('./nexo/validator');

class PhysicalTerminalBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = opts.host || '0.0.0.0';
    this.port = opts.port !== undefined ? Number(opts.port) : 9101;
    this.validator = opts.validator || new MessageValidator();
    this.server = null;
    this.socket = null;
    this.buffer = '';
    this.running = false;
    this.remoteAddress = null;
    this.connectedAt = null;
    this.lastMessageAt = null;
    this.lastValidMessageAt = null;
    this.lastInvalidMessageAt = null;
    this.lastError = null;
    this.messagesReceived = 0;
  }

  start() {
    if (this.server) return;
    this.server = net.createServer((socket) => this._handleConnection(socket));
    this.server.on('error', (err) => {
      this.lastError = err.message;
      this.emit('errorStatus', err);
      this._emitStatus();
    });
    this.server.listen(this.port, this.host, () => {
      const address = this.server.address();
      if (address && typeof address === 'object') this.port = address.port;
      this.running = true;
      this.lastError = null;
      this._emitStatus();
    });
  }

  stop() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.running = false;
    this.remoteAddress = null;
    this.connectedAt = null;
    this._emitStatus();
  }

  configure({ host, port }) {
    const nextHost = host || this.host;
    const nextPort = Number(port || this.port);
    if (nextHost === this.host && nextPort === this.port) return;
    this.stop();
    this.host = nextHost;
    this.port = nextPort;
    this.start();
  }

  isConnected() {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  send(xml) {
    if (!this.isConnected()) throw new Error('No physical terminal connected');
    this.socket.write(xml);
    this.lastMessageAt = new Date().toISOString();
    this._emitStatus();
  }

  getStatus() {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      connected: this.isConnected(),
      remoteAddress: this.remoteAddress,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastValidMessageAt: this.lastValidMessageAt,
      lastInvalidMessageAt: this.lastInvalidMessageAt,
      lastError: this.lastError,
      messagesReceived: this.messagesReceived,
    };
  }

  _handleConnection(socket) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }

    this.socket = socket;
    this.buffer = '';
    this.remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    this.connectedAt = new Date().toISOString();
    this.lastError = null;
    this._emitStatus();

    socket.on('data', (chunk) => this._handleData(chunk));
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.remoteAddress = null;
        this.connectedAt = null;
        this._emitStatus();
      }
    });
    socket.on('error', (err) => {
      this.lastError = err.message;
      this.emit('terminalError', err);
      this._emitStatus();
    });
  }

  _handleData(chunk) {
    this.buffer += chunk.toString('utf8');
    const extracted = extractXmlDocuments(this.buffer);
    this.buffer = extracted.rest;

    for (const xml of extracted.documents) {
      this.lastMessageAt = new Date().toISOString();
      try {
        const parsed = parseXml(xml);
        const rootKey = getRootKey(parsed);
        const msgFunction = detectMessageFunction(parsed, rootKey);
        const exchangeId = extractExchangeId(parsed, rootKey);
        const validation = this.validator.validate(msgFunction, parsed);
        this.messagesReceived += 1;
        if (validation.valid) this.lastValidMessageAt = this.lastMessageAt;
        else this.lastInvalidMessageAt = this.lastMessageAt;
        this.emit('wireMessage', {
          direction: 'poi-to-sale',
          xml,
          json: parsed,
          rootKey,
          msgFunction,
          exchangeId,
          validation,
          source: 'physical',
          remoteAddress: this.remoteAddress,
          timestamp: this.lastMessageAt,
        });
      } catch (err) {
        this.lastError = err.message;
        this.lastInvalidMessageAt = this.lastMessageAt;
        this.emit('terminalError', err);
      }
    }

    this._emitStatus();
  }

  _emitStatus() {
    this.emit('status', this.getStatus());
  }
}

module.exports = { PhysicalTerminalBridge };
