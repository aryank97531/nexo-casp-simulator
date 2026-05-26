/**
 * nexo CASP v8.0 Pinpad Simulator - Frontend Application
 */
(function () {
  'use strict';

  let ws = null;
  let config = {};
  let loggedIn = false;
  let pinBuffer = '';
  let pinMode = false;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const els = {
    connectionBadge: $('#connectionBadge'),
    loginBadge: $('#loginBadge'),
    terminalBadge: $('#terminalBadge'),
    terminalModeLabel: $('#terminalModeLabel'),
    terminalEndpoint: $('#terminalEndpoint'),
    terminalRemote: $('#terminalRemote'),
    terminalState: $('#terminalState'),
    terminalLastMessage: $('#terminalLastMessage'),
    saleId: $('#saleId'),
    poiId: $('#poiId'),
    txAmount: $('#txAmount'),
    txCurrency: $('#txCurrency'),
    cardProfile: $('#cardProfile'),
    forceDecline: $('#forceDecline'),
    messageLog: $('#messageLog'),
    screenLine1: $('#screenLine1'),
    screenLine2: $('#screenLine2'),
    screenLine3: $('#screenLine3'),
    screenLine4: $('#screenLine4'),
    pinpadScreen: $('#pinpadScreen'),
    pinpadDevice: $('#pinpadDevice'),
    cardSlot: $('#cardSlot'),
    ledConn: $('#ledConn'),
    ledProc: $('#ledProc'),
    receiptContent: $('#receiptContent'),
    historyList: $('#historyList'),
    txCount: $('#txCount'),
    msgFilter: $('#msgFilter'),
    xmlViewer: $('#xmlViewer'),
    xmlModalTitle: $('#xmlModalTitle'),
  };

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      els.connectionBadge.classList.add('connected');
      els.connectionBadge.querySelector('.text').textContent = 'Connected';
      els.ledConn.classList.add('on');
    };

    ws.onclose = () => {
      els.connectionBadge.classList.remove('connected');
      els.connectionBadge.querySelector('.text').textContent = 'Disconnected';
      els.ledConn.classList.remove('on');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => { ws.close(); };

    ws.onmessage = (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init':
        config = msg.config;
        loggedIn = msg.loggedIn;
        updateLoginState();
        if (msg.nexoServer) updateNexoServerStatus(msg.nexoServer);
        if (msg.terminal) updateTerminalStatus(msg.terminal, msg.activeTerminalMode);
        break;
      case 'messageLogged':
        addMessageEntry(msg.message, msg.direction);
        break;
      case 'pinpadDisplay':
        updatePinpadScreen(msg.text, msg.status, msg.requiresInput);
        break;
      case 'receipt':
        showReceipt(msg.text);
        break;
      case 'transactionLogged':
        updateTransactionHistory(msg.transactions);
        break;
      case 'configUpdated':
        config = msg.config;
        syncConfigFields();
        break;
      case 'cardSelected':
        updateCardDisplay(msg.card);
        break;
      case 'pinEntered':
        pinMode = false;
        pinBuffer = '';
        break;
      case 'historyCleared':
        resetHistory();
        clearMessageLog();
        break;
      case 'scenarioStarted':
        updatePinpadScreen('SCENARIO RUNNING', 'warning');
        break;
      case 'scenarioCompleted':
        updatePinpadScreen('SCENARIO COMPLETE', 'success');
        break;
      case 'error':
        updatePinpadScreen(`ERROR: ${msg.error}`, 'error');
        break;
      case 'nexoServerStatus':
        updateNexoServerStatus(msg);
        break;
      case 'nexoClientConnected':
      case 'nexoClientDisconnected':
        updateNexoClientCount(msg.clientCount);
        break;
      case 'loginStateChanged':
        loggedIn = msg.loggedIn;
        updateLoginState();
        break;
      case 'rawXmlResponse':
        showRawXmlResponse(msg.xml);
        break;
      case 'terminalStatus':
        updateTerminalStatus(msg.status, msg.mode);
        break;
      case 'terminalError':
        updateTerminalStatus(msg.status, msg.mode);
        updatePinpadScreen(`TERMINAL ERROR: ${msg.error}`, 'error');
        break;
    }
  }

  function updatePinpadScreen(text, status, requiresInput) {
    els.pinpadScreen.className = 'pinpad-screen';
    if (status === 'error' || status === 'declined') els.pinpadScreen.classList.add('error');
    else if (status === 'success') els.pinpadScreen.classList.add('success');
    else if (status === 'warning') els.pinpadScreen.classList.add('warning');

    if (text === 'AUTHORISING...' || text === 'PRESENT CARD') {
      els.ledProc.classList.add('active');
      els.cardSlot.classList.add('active');
    } else if (status === 'success' || status === 'declined' || status === 'error') {
      els.ledProc.classList.remove('active');
      els.cardSlot.classList.remove('active');
      els.pinpadDevice.classList.add(status === 'success' ? 'flash-success' : 'flash-error');
      setTimeout(() => els.pinpadDevice.classList.remove('flash-success', 'flash-error'), 600);
    }

    if (text === 'LOGIN SUCCESSFUL' || text === 'TERMINAL LOGIN OK') {
      loggedIn = true;
      updateLoginState();
    } else if (text === 'LOGOUT OK' || text === 'TERMINAL LOGOUT OK') {
      loggedIn = false;
      updateLoginState();
    }

    if (requiresInput) {
      pinMode = true;
      pinBuffer = '';
      els.screenLine1.textContent = text;
      els.screenLine2.textContent = '____';
      els.screenLine3.textContent = 'Enter PIN on keypad';
      els.screenLine4.textContent = '';
      return;
    }

    const lines = String(text || '').split('\n');
    els.screenLine1.textContent = lines[0] || '';
    els.screenLine2.textContent = lines[1] || '';
    els.screenLine3.textContent = lines[2] || '';
    els.screenLine4.textContent = lines[3] || '';
  }

  function updateLoginState() {
    els.loginBadge.textContent = loggedIn ? 'Logged In' : 'Logged Out';
    els.loginBadge.classList.toggle('active', loggedIn);
  }

  function addMessageEntry(message, direction) {
    const empty = $('#emptyMessages');
    if (empty) empty.remove();

    const mf = message.msgFunction || '';
    const isDevice = mf.startsWith('D');
    const isSystem = mf.startsWith('SS');
    const isAdmin = mf.startsWith('SM') || mf.startsWith('AD') || mf.startsWith('RP') || mf === 'SASQ' || mf === 'SASP';
    const isFinancial = mf.startsWith('FS');
    const filter = els.msgFilter.value;

    let visible = filter === 'all';
    if (filter === 'financial' && isFinancial) visible = true;
    if (filter === 'admin' && isAdmin) visible = true;
    if (filter === 'device' && isDevice) visible = true;
    if (filter === 'system' && isSystem) visible = true;

    const time = new Date(message.timestamp).toLocaleTimeString('en-AU', { hour12: false });
    const dirClass = direction || message.direction || 'sale-to-poi';
    const dirLabel = dirClass === 'sale-to-poi' ? 'SALE->POI' : 'POI->SALE';

    const entry = el('div', `msg-entry slide-in ${message.isDeviceMessage ? 'msg-device' : ''}`);
    entry.style.display = visible ? 'flex' : 'none';
    entry.dataset.type = isFinancial ? 'financial' : isAdmin ? 'admin' : isDevice ? 'device' : 'system';

    entry.appendChild(el('span', `msg-direction ${dirClass}`, dirLabel));
    const body = el('div', 'msg-body');
    body.appendChild(el('span', 'msg-name', message.name || mf));
    body.appendChild(el('span', 'msg-code', mf));
    if (message.validation) {
      body.appendChild(el(
        'span',
        `msg-validation ${message.validation.valid ? 'valid' : 'invalid'}`,
        message.validation.valid ? 'Valid' : 'Invalid'
      ));
    }
    if (message.source === 'external' || message.source === 'physical') {
      body.appendChild(el('span', `msg-source ${message.source}`, message.source === 'physical' ? 'TCP' : 'EXT'));
    }
    body.appendChild(el('div', 'msg-time', `${time} | #${message.id}`));
    entry.appendChild(body);

    entry.addEventListener('click', () => showXmlModal(message));
    els.messageLog.prepend(entry);

    const entries = els.messageLog.querySelectorAll('.msg-entry');
    if (entries.length > 200) entries[entries.length - 1].remove();
  }

  function clearMessageLog() {
    els.messageLog.replaceChildren(emptyState('emptyMessages', 'No messages yet', 'Send a request to see nexo messages here'));
  }

  function showXmlModal(message) {
    els.xmlModalTitle.textContent = `${message.name || message.msgFunction} - ${message.direction === 'sale-to-poi' ? 'Sale -> POI' : 'POI -> Sale'}`;
    const xml = message.xml || JSON.stringify(message.json, null, 2) || 'No XML content';
    els.xmlViewer.textContent = xml;
    $('#xmlModal').classList.add('open');
  }

  function showReceipt(text) {
    els.receiptContent.textContent = text;
    els.receiptContent.scrollTop = 0;
  }

  function updateTransactionHistory(transactions) {
    if (!transactions || !transactions.length) {
      resetHistory();
      return;
    }
    els.txCount.textContent = `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`;
    const cards = transactions.map((tx) => {
      const time = new Date(tx.timestamp).toLocaleTimeString('en-AU', { hour12: false });
      const amountStr = tx.amount ? `$${parseFloat(tx.amount).toFixed(2)}` : '';
      const card = el('div', 'tx-card');
      const top = el('div', 'tx-card-top');
      top.appendChild(el('span', 'tx-action', tx.action || 'transaction'));
      top.appendChild(el('span', `tx-status ${tx.status || ''}`, String(tx.status || '').toUpperCase()));
      card.appendChild(top);
      card.appendChild(el('div', 'tx-amount', `${amountStr} ${tx.currency || ''}`.trim()));
      card.appendChild(el('div', 'tx-meta', `${tx.card || ''} | ${time} | ${tx.exchangeId || ''}`));
      return card;
    });
    els.historyList.replaceChildren(...cards);
  }

  function resetHistory() {
    els.historyList.replaceChildren(el('div', 'empty-state-inline', 'No transactions recorded'));
    els.txCount.textContent = '0 transactions';
  }

  function updateCardDisplay(card) {
    els.screenLine3.textContent = `Card: ${card.brand}`;
  }

  function initEventHandlers() {
    $$('.btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        send({
          type: 'sendRequest',
          action: btn.dataset.action,
          params: {
            amount: els.txAmount.value,
            currency: els.txCurrency.value,
          },
        });
        els.ledProc.classList.add('active');
      });
    });

    els.cardProfile.addEventListener('change', () => {
      send({ type: 'selectCard', cardProfile: els.cardProfile.value });
    });

    els.forceDecline.addEventListener('change', () => {
      send({ type: 'setForceDecline', value: els.forceDecline.checked });
    });

    els.saleId.addEventListener('change', () => {
      send({ type: 'updateConfig', config: { saleId: els.saleId.value } });
    });
    els.poiId.addEventListener('change', () => {
      send({ type: 'updateConfig', config: { poiId: els.poiId.value } });
    });

    $$('.key').forEach(key => {
      key.addEventListener('click', () => {
        const k = key.dataset.key;
        if (pinMode) {
          if (k === 'cancel') {
            pinMode = false;
            pinBuffer = '';
            send({ type: 'pinEntry', pin: '' });
            updatePinpadScreen('PIN CANCELLED', 'error');
          } else if (k === 'clear') {
            pinBuffer = pinBuffer.slice(0, -1);
            els.screenLine2.textContent = '*'.repeat(pinBuffer.length) + '_'.repeat(Math.max(0, 4 - pinBuffer.length));
          } else if (k === 'ok') {
            if (pinBuffer.length >= 4) {
              send({ type: 'pinEntry', pin: pinBuffer });
              pinMode = false;
              pinBuffer = '';
              els.screenLine2.textContent = 'PIN OK';
            }
          } else if (/^\d$/.test(k) && pinBuffer.length < 12) {
            pinBuffer += k;
            els.screenLine2.textContent = '*'.repeat(pinBuffer.length);
          }
        }
        key.style.transform = 'scale(0.92)';
        setTimeout(() => { key.style.transform = ''; }, 100);
      });
    });

    els.msgFilter.addEventListener('change', () => {
      const filter = els.msgFilter.value;
      els.messageLog.querySelectorAll('.msg-entry').forEach(entry => {
        entry.style.display = filter === 'all' || entry.dataset.type === filter ? 'flex' : 'none';
      });
    });

    bindModal('#btnConfig', '#configModal');
    bindModal('#btnScenarios', '#scenarioModal');
    bindModal('#btnRawXml', '#rawXmlModal');
    bindModal('#nexoBadge', '#nexoInfoModal');
    bindModal('#terminalBadge', '#terminalInfoModal');
    $('#closeConfig').addEventListener('click', () => $('#configModal').classList.remove('open'));
    $('#closeScenario').addEventListener('click', () => $('#scenarioModal').classList.remove('open'));
    $('#closeXml').addEventListener('click', () => $('#xmlModal').classList.remove('open'));
    $('#closeRawXml').addEventListener('click', () => $('#rawXmlModal').classList.remove('open'));
    $('#closeNexoInfo').addEventListener('click', () => $('#nexoInfoModal').classList.remove('open'));
    $('#closeTerminalInfo').addEventListener('click', () => $('#terminalInfoModal').classList.remove('open'));

    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });

    $('#btnCopyXml').addEventListener('click', () => {
      navigator.clipboard.writeText(els.xmlViewer.textContent).then(() => {
        $('#btnCopyXml').textContent = 'Copied!';
        setTimeout(() => { $('#btnCopyXml').textContent = 'Copy'; }, 1500);
      });
    });

    $('#btnSaveConfig').addEventListener('click', () => {
      send({
        type: 'updateConfig',
        config: {
          merchantName: $('#cfgMerchantName').value,
          merchantCategoryCode: $('#cfgMCC').value,
          merchantCountry: $('#cfgCountry').value,
          responseDelay: parseInt($('#cfgDelay').value, 10) || 1500,
          autoRespond: $('#cfgAutoRespond').checked,
          terminalMode: $('#cfgTerminalMode').value,
        },
      });
      $('#configModal').classList.remove('open');
    });

    $$('.scenario-card').forEach(card => {
      card.addEventListener('click', () => {
        send({ type: 'runScenario', scenario: card.dataset.scenario });
        $('#scenarioModal').classList.remove('open');
      });
    });

    $$('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        $('#rawXmlInput').value = getXmlTemplate(btn.dataset.template);
      });
    });

    $('#btnSendRawXml').addEventListener('click', () => {
      const xml = $('#rawXmlInput').value.trim();
      if (!xml) {
        $('#rawXmlStatus').textContent = 'Empty XML';
        $('#rawXmlStatus').className = 'raw-xml-status err';
        return;
      }
      send({ type: 'sendRawXml', xml });
      $('#rawXmlStatus').textContent = 'Sent - waiting for response...';
      $('#rawXmlStatus').className = 'raw-xml-status';
    });

    $('#btnClearMessages').addEventListener('click', () => clearMessageLog());
    $('#btnClearReceipt').addEventListener('click', () => { els.receiptContent.textContent = 'No receipts yet.'; });
    $('#btnClearHistory').addEventListener('click', () => send({ type: 'clearHistory' }));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    });
  }

  function bindModal(buttonSelector, modalSelector) {
    const button = $(buttonSelector);
    const modal = $(modalSelector);
    if (button && modal) button.addEventListener('click', () => modal.classList.add('open'));
  }

  function updateNexoServerStatus(status) {
    const badge = $('#nexoBadge');
    if (status.status === 'listening' || status.running) badge.classList.add('listening');
    else badge.classList.remove('listening');
    updateNexoClientCount(status.clientCount || 0);
  }

  function updateNexoClientCount(count) {
    $('#nexoClientCount').textContent = count;
    const modal = $('#nexoClientCountModal');
    if (modal) modal.textContent = count;
  }

  function updateTerminalStatus(status = {}, activeMode) {
    const connected = Boolean(status.connected);
    els.terminalBadge.classList.toggle('connected', connected);
    els.terminalModeLabel.textContent = connected ? 'TCP Live' : `TCP ${activeMode || 'virtual'}`;
    els.terminalEndpoint.textContent = `${status.host || config.physicalTcpHost || '0.0.0.0'}:${status.port || config.physicalTcpPort || 9101}`;
    els.terminalRemote.textContent = status.remoteAddress || 'No terminal connected';
    els.terminalState.textContent = connected ? 'Connected' : status.running ? 'Listening' : 'Stopped';
    els.terminalState.className = `status-tag ${connected ? 'listening' : status.lastError ? 'error' : ''}`;
    els.terminalLastMessage.textContent = status.lastMessageAt ? new Date(status.lastMessageAt).toLocaleTimeString('en-AU', { hour12: false }) : 'None';
    const error = $('#terminalLastError');
    if (error) error.textContent = status.lastError || 'None';
  }

  function syncConfigFields() {
    if ($('#cfgTerminalMode')) $('#cfgTerminalMode').value = config.terminalMode || 'auto';
    if ($('#cfgMerchantName')) $('#cfgMerchantName').value = config.merchantName || '';
    if ($('#cfgMCC')) $('#cfgMCC').value = config.merchantCategoryCode || '';
    if ($('#cfgCountry')) $('#cfgCountry').value = config.merchantCountry || '';
    if ($('#cfgDelay')) $('#cfgDelay').value = config.responseDelay || 1500;
    if ($('#cfgAutoRespond')) $('#cfgAutoRespond').checked = config.autoRespond !== false;
  }

  function showRawXmlResponse(xml) {
    const section = $('#rawXmlResponseSection');
    section.style.display = 'block';
    $('#rawXmlResponse').textContent = xml || '';
    $('#rawXmlStatus').textContent = 'Response received';
    $('#rawXmlStatus').className = 'raw-xml-status ok';
  }

  function getXmlTemplate(name) {
    const saleId = els.saleId.value || 'SaleTerminal01';
    const poiId = els.poiId.value || 'POITerminal01';
    const dt = new Date().toISOString();
    const xid = Math.random().toString(16).slice(2, 10).toUpperCase();
    const templates = {
      login: `<SaleToPOISsnMgmtReq>\n  <Hdr>\n    <MsgFctn>SASQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SsnMgmtReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt><AttndncCntxt>ATTD</AttndncCntxt></PmtCntxt></Cntxt>\n    <SvcCntt>SMIQ</SvcCntt>\n    <LgnReq>\n      <DtTm>${dt}</DtTm>\n      <SaleSftwr><ManfctrId>TestTool</ManfctrId><CmpntTp>SOFT</CmpntTp><Id><Id>test-v1</Id></Id></SaleSftwr>\n      <SaleTermnlData><TtlNbOfSaleTermnls>1</TtlNbOfSaleTermnls></SaleTermnlData>\n    </LgnReq>\n  </SsnMgmtReq>\n</SaleToPOISsnMgmtReq>`,
      payment: `<SaleToPOISvcReq>\n  <Hdr>\n    <MsgFctn>SFSQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SvcReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt><AttndncCntxt>ATTD</AttndncCntxt></PmtCntxt></Cntxt>\n    <SvcCntt>FSPQ</SvcCntt>\n    <PmtReq>\n      <SaleTxId><TxId>SALE-${xid}</TxId><TxDtTm>${dt}</TxDtTm></SaleTxId>\n      <PmtTp>CRDP</PmtTp>\n      <Tx><TxTp>CRDP</TxTp><TtlAmt>${els.txAmount.value || '49.95'}</TtlAmt><Ccy>AUD</Ccy><AmtQlfr>ACTL</AmtQlfr></Tx>\n    </PmtReq>\n  </SvcReq>\n</SaleToPOISvcReq>`,
      diagnosis: `<SaleToPOISsnMgmtReq>\n  <Hdr>\n    <MsgFctn>SASQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SsnMgmtReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt/></Cntxt>\n    <SvcCntt>SMDQ</SvcCntt>\n    <DgnssReq><POIId><Id>${poiId}</Id></POIId></DgnssReq>\n  </SsnMgmtReq>\n</SaleToPOISsnMgmtReq>`,
      reconciliation: `<SaleToPOIRcncltnReq>\n  <Hdr>\n    <MsgFctn>FSCQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <RcncltnReq>\n    <RcncltnTp>SREC</RcncltnTp>\n  </RcncltnReq>\n</SaleToPOIRcncltnReq>`,
      logout: `<SaleToPOISsnMgmtReq>\n  <Hdr>\n    <MsgFctn>SASQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SsnMgmtReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt/></Cntxt>\n    <SvcCntt>SMOQ</SvcCntt>\n    <LgotReq><MntncAllwd>true</MntncAllwd></LgotReq>\n  </SsnMgmtReq>\n</SaleToPOISsnMgmtReq>`,
    };
    return templates[name] || '';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function emptyState(id, title, subtitle) {
    const node = el('div', 'empty-state');
    node.id = id;
    node.appendChild(el('p', '', title));
    node.appendChild(el('span', '', subtitle));
    return node;
  }

  function init() {
    initEventHandlers();
    clearMessageLog();
    syncConfigFields();
    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
