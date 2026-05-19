/**
 * nexo CASP v8.0 Pinpad Simulator — Frontend Application
 */
(function () {
  'use strict';

  // ═══ STATE ═══
  let ws = null;
  let config = {};
  let loggedIn = false;
  let pinBuffer = '';
  let pinMode = false;
  let nexoClientCount = 0;

  // ═══ DOM REFS ═══
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const els = {
    connectionBadge: $('#connectionBadge'),
    loginBadge: $('#loginBadge'),
    saleId: $('#saleId'),
    poiId: $('#poiId'),
    txAmount: $('#txAmount'),
    txCurrency: $('#txCurrency'),
    cardProfile: $('#cardProfile'),
    forceDecline: $('#forceDecline'),
    messageLog: $('#messageLog'),
    emptyMessages: $('#emptyMessages'),
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

  // ═══ WEBSOCKET ═══
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
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
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

  // ═══ SERVER MESSAGE HANDLER ═══
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init':
        config = msg.config;
        loggedIn = msg.loggedIn;
        updateLoginState();
        if (msg.nexoServer) updateNexoServerStatus(msg.nexoServer);
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
        break;

      case 'cardSelected':
        updateCardDisplay(msg.card);
        break;

      case 'pinEntered':
        pinMode = false;
        pinBuffer = '';
        break;

      case 'historyCleared':
        els.historyList.innerHTML = '<div class="empty-state-inline">No transactions recorded</div>';
        els.txCount.textContent = '0 transactions';
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

      // nexo WS server events
      case 'nexoServerStatus':
        updateNexoServerStatus(msg);
        break;
      case 'nexoClientConnected':
        updateNexoClientCount(msg.clientCount);
        break;
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
    }
  }

  // ═══ PINPAD SCREEN ═══
  function updatePinpadScreen(text, status, requiresInput) {
    els.pinpadScreen.className = 'pinpad-screen';
    if (status === 'error' || status === 'declined') els.pinpadScreen.classList.add('error');
    else if (status === 'success') els.pinpadScreen.classList.add('success');
    else if (status === 'warning') els.pinpadScreen.classList.add('warning');

    // Handle processing LED
    if (text === 'AUTHORISING...' || text === 'PRESENT CARD') {
      els.ledProc.classList.add('active');
      els.cardSlot.classList.add('active');
    } else if (status === 'success' || status === 'declined' || status === 'error') {
      els.ledProc.classList.remove('active');
      els.cardSlot.classList.remove('active');
      // Flash device
      els.pinpadDevice.classList.add(status === 'success' ? 'flash-success' : 'flash-error');
      setTimeout(() => els.pinpadDevice.classList.remove('flash-success', 'flash-error'), 600);
    }

    // Check for login/logout state updates
    if (text === 'LOGIN SUCCESSFUL') {
      loggedIn = true;
      updateLoginState();
    } else if (text === 'LOGOUT OK') {
      loggedIn = false;
      updateLoginState();
    }

    // Handle PIN mode
    if (requiresInput) {
      pinMode = true;
      pinBuffer = '';
      els.screenLine1.textContent = text;
      els.screenLine2.textContent = '____';
      els.screenLine3.textContent = 'Enter PIN on keypad';
      els.screenLine4.textContent = '';
      return;
    }

    // Split text across lines
    const lines = text.split('\n');
    els.screenLine1.textContent = lines[0] || '';
    els.screenLine2.textContent = lines[1] || '';
    els.screenLine3.textContent = lines[2] || '';
    els.screenLine4.textContent = lines[3] || '';
  }

  function updateLoginState() {
    els.loginBadge.textContent = loggedIn ? 'Logged In' : 'Logged Out';
    els.loginBadge.classList.toggle('active', loggedIn);
  }

  // ═══ MESSAGE LOG ═══
  let messageCount = 0;
  function addMessageEntry(message, direction) {
    if (els.emptyMessages) els.emptyMessages.remove();
    messageCount++;

    const filter = els.msgFilter.value;
    const mf = message.msgFunction || '';
    const isDevice = mf.startsWith('D');
    const isSystem = mf.startsWith('SS');
    const isAdmin = mf.startsWith('SM') || mf.startsWith('AD') || mf.startsWith('RP') || mf === 'SARQ' || mf === 'SASP';
    const isFinancial = mf.startsWith('FS');

    let visible = filter === 'all';
    if (filter === 'financial' && isFinancial) visible = true;
    if (filter === 'admin' && isAdmin) visible = true;
    if (filter === 'device' && isDevice) visible = true;
    if (filter === 'system' && isSystem) visible = true;

    const time = new Date(message.timestamp).toLocaleTimeString('en-AU', { hour12: false });
    const dirClass = direction || message.direction || 'sale-to-poi';
    const dirLabel = dirClass === 'sale-to-poi' ? 'SALE→POI' : 'POI→SALE';
    const validHtml = message.validation
      ? `<span class="msg-validation ${message.validation.valid ? 'valid' : 'invalid'}">${message.validation.valid ? '✓ Valid' : '✗ Invalid'}</span>`
      : '';
    const sourceHtml = message.source === 'external'
      ? '<span class="msg-source external">EXT</span>'
      : '';

    const entry = document.createElement('div');
    entry.className = `msg-entry slide-in ${message.isDeviceMessage ? 'msg-device' : ''}`;
    entry.style.display = visible ? 'flex' : 'none';
    entry.dataset.type = isFinancial ? 'financial' : isAdmin ? 'admin' : isDevice ? 'device' : 'system';
    entry.innerHTML = `
      <span class="msg-direction ${dirClass}">${dirLabel}</span>
      <div class="msg-body">
        <span class="msg-name">${message.name || mf}</span>
        <span class="msg-code">${mf}</span>
        ${validHtml}${sourceHtml}
        <div class="msg-time">${time} · #${message.id}</div>
      </div>
    `;

    entry.addEventListener('click', () => showXmlModal(message));
    els.messageLog.prepend(entry);

    // Limit entries
    const entries = els.messageLog.querySelectorAll('.msg-entry');
    if (entries.length > 200) entries[entries.length - 1].remove();
  }

  function clearMessageLog() {
    messageCount = 0;
    els.messageLog.innerHTML = `
      <div class="empty-state" id="emptyMessages">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <p>No messages yet</p><span>Send a request to see nexo messages here</span>
      </div>`;
  }

  // ═══ XML VIEWER ═══
  function showXmlModal(message) {
    els.xmlModalTitle.textContent = `${message.name || message.msgFunction} — ${message.direction === 'sale-to-poi' ? 'Sale → POI' : 'POI → Sale'}`;
    const xml = message.xml || JSON.stringify(message.json, null, 2);
    els.xmlViewer.innerHTML = highlightXml(xml);
    $('#xmlModal').classList.add('open');
  }

  function highlightXml(xml) {
    if (!xml) return '<span style="color:var(--text-muted)">No XML content</span>';
    return xml
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/(&lt;\/?)([\w:]+)/g, '$1<span class="xml-tag">$2</span>')
      .replace(/([\w-]+)=(".*?")/g, '<span class="xml-attr">$1</span>=<span class="xml-value">$2</span>')
      .replace(/&gt;([^&<]+)&lt;/g, '&gt;<span class="xml-text">$1</span>&lt;');
  }

  // ═══ RECEIPT ═══
  function showReceipt(text) {
    els.receiptContent.textContent = text;
    els.receiptContent.scrollTop = 0;
  }

  // ═══ TRANSACTION HISTORY ═══
  function updateTransactionHistory(transactions) {
    if (!transactions || !transactions.length) return;
    els.txCount.textContent = `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`;

    els.historyList.innerHTML = transactions.map(tx => {
      const time = new Date(tx.timestamp).toLocaleTimeString('en-AU', { hour12: false });
      const amountStr = tx.amount ? `$${parseFloat(tx.amount).toFixed(2)}` : '';
      return `
        <div class="tx-card">
          <div class="tx-card-top">
            <span class="tx-action">${tx.action}</span>
            <span class="tx-status ${tx.status || ''}">${(tx.status || '').toUpperCase()}</span>
          </div>
          <div class="tx-amount">${amountStr} ${tx.currency || ''}</div>
          <div class="tx-meta">${tx.card || ''} · ${time} · ${tx.exchangeId || ''}</div>
        </div>
      `;
    }).join('');
  }

  function updateCardDisplay(card) {
    // Update screen briefly
    els.screenLine3.textContent = `Card: ${card.brand}`;
  }

  // ═══ EVENT HANDLERS ═══
  function initEventHandlers() {
    // Action buttons
    $$('.btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const params = {
          amount: els.txAmount.value,
          currency: els.txCurrency.value,
        };
        send({ type: 'sendRequest', action, params });
        // Flash the processing LED
        els.ledProc.classList.add('active');
      });
    });

    // Card profile change
    els.cardProfile.addEventListener('change', () => {
      send({ type: 'selectCard', cardProfile: els.cardProfile.value });
    });

    // Force decline toggle
    els.forceDecline.addEventListener('change', () => {
      send({ type: 'setForceDecline', value: els.forceDecline.checked });
    });

    // Sale/POI ID changes
    els.saleId.addEventListener('change', () => {
      send({ type: 'updateConfig', config: { saleId: els.saleId.value } });
    });
    els.poiId.addEventListener('change', () => {
      send({ type: 'updateConfig', config: { poiId: els.poiId.value } });
    });

    // Keypad
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
        // Visual feedback
        key.style.transform = 'scale(0.92)';
        setTimeout(() => key.style.transform = '', 100);
      });
    });

    // Message filter
    els.msgFilter.addEventListener('change', () => {
      const filter = els.msgFilter.value;
      els.messageLog.querySelectorAll('.msg-entry').forEach(entry => {
        if (filter === 'all') { entry.style.display = 'flex'; return; }
        entry.style.display = entry.dataset.type === filter ? 'flex' : 'none';
      });
    });

    // Modals
    $('#btnConfig').addEventListener('click', () => $('#configModal').classList.add('open'));
    $('#closeConfig').addEventListener('click', () => $('#configModal').classList.remove('open'));
    $('#btnScenarios').addEventListener('click', () => $('#scenarioModal').classList.add('open'));
    $('#closeScenario').addEventListener('click', () => $('#scenarioModal').classList.remove('open'));
    $('#closeXml').addEventListener('click', () => $('#xmlModal').classList.remove('open'));
    $('#btnRawXml').addEventListener('click', () => $('#rawXmlModal').classList.add('open'));
    $('#closeRawXml').addEventListener('click', () => $('#rawXmlModal').classList.remove('open'));
    $('#nexoBadge').addEventListener('click', () => $('#nexoInfoModal').classList.add('open'));
    $('#closeNexoInfo').addEventListener('click', () => $('#nexoInfoModal').classList.remove('open'));

    // Close modals on overlay click
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });

    // Copy XML
    $('#btnCopyXml').addEventListener('click', () => {
      const text = els.xmlViewer.textContent;
      navigator.clipboard.writeText(text).then(() => {
        $('#btnCopyXml').textContent = 'Copied!';
        setTimeout(() => $('#btnCopyXml').textContent = 'Copy', 1500);
      });
    });

    // Save config
    $('#btnSaveConfig').addEventListener('click', () => {
      send({
        type: 'updateConfig',
        config: {
          merchantName: $('#cfgMerchantName').value,
          merchantCategoryCode: $('#cfgMCC').value,
          merchantCountry: $('#cfgCountry').value,
          responseDelay: parseInt($('#cfgDelay').value) || 1500,
          autoRespond: $('#cfgAutoRespond').checked,
        },
      });
      $('#configModal').classList.remove('open');
    });

    // Scenarios
    $$('.scenario-card').forEach(card => {
      card.addEventListener('click', () => {
        send({ type: 'runScenario', scenario: card.dataset.scenario });
        $('#scenarioModal').classList.remove('open');
      });
    });

    // Raw XML templates
    $$('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        $('#rawXmlInput').value = getXmlTemplate(btn.dataset.template);
      });
    });

    // Send Raw XML
    $('#btnSendRawXml').addEventListener('click', () => {
      const xml = $('#rawXmlInput').value.trim();
      if (!xml) { $('#rawXmlStatus').textContent = 'Empty XML'; $('#rawXmlStatus').className = 'raw-xml-status err'; return; }
      send({ type: 'sendRawXml', xml });
      $('#rawXmlStatus').textContent = 'Sent — waiting for response...';
      $('#rawXmlStatus').className = 'raw-xml-status';
    });

    // Clear buttons
    $('#btnClearMessages').addEventListener('click', () => clearMessageLog());
    $('#btnClearReceipt').addEventListener('click', () => { els.receiptContent.textContent = 'No receipts yet.'; });
    $('#btnClearHistory').addEventListener('click', () => send({ type: 'clearHistory' }));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      }
    });
  }

  // ═══ NEXO WS SERVER ═══
  function updateNexoServerStatus(status) {
    const badge = $('#nexoBadge');
    if (status.status === 'listening' || status.running) {
      badge.classList.add('listening');
    } else {
      badge.classList.remove('listening');
    }
    updateNexoClientCount(status.clientCount || 0);
  }

  function updateNexoClientCount(count) {
    nexoClientCount = count;
    $('#nexoClientCount').textContent = count;
    const modal = $('#nexoClientCountModal');
    if (modal) modal.textContent = count;
  }

  function showRawXmlResponse(xml) {
    const section = $('#rawXmlResponseSection');
    section.style.display = 'block';
    $('#rawXmlResponse').innerHTML = highlightXml(xml);
    $('#rawXmlStatus').textContent = 'Response received ✓';
    $('#rawXmlStatus').className = 'raw-xml-status ok';
  }

  function getXmlTemplate(name) {
    const saleId = els.saleId.value || 'SaleTerminal01';
    const poiId = els.poiId.value || 'POITerminal01';
    const dt = new Date().toISOString();
    const xid = Math.random().toString(16).slice(2, 10).toUpperCase();
    const templates = {
      login: `<SaleToPOISsnMgmtReq>\n  <Hdr>\n    <MsgFctn>SARQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SsnMgmtReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt><AttndncCntxt>ATTD</AttndncCntxt></PmtCntxt></Cntxt>\n    <SvcCntt>SMIQ</SvcCntt>\n    <LgnReq>\n      <DtTm>${dt}</DtTm>\n      <SaleSftwr><ManfctrId>TestTool</ManfctrId><CmpntTp>SOFT</CmpntTp><Id><Id>test-v1</Id></Id></SaleSftwr>\n      <SaleTermnlData><TtlNbOfSaleTermnls>1</TtlNbOfSaleTermnls></SaleTermnlData>\n    </LgnReq>\n  </SsnMgmtReq>\n</SaleToPOISsnMgmtReq>`,
      payment: `<SaleToPOISvcReq>\n  <Hdr>\n    <MsgFctn>FSPQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SvcReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt><AttndncCntxt>ATTD</AttndncCntxt></PmtCntxt></Cntxt>\n    <SvcCntt>FSPQ</SvcCntt>\n    <PmtReq>\n      <SaleTxId><TxId>SALE-${xid}</TxId><TxDtTm>${dt}</TxDtTm></SaleTxId>\n      <PmtTp>CRDP</PmtTp>\n      <Tx><TxTp>CRDP</TxTp><TtlAmt>${els.txAmount.value || '49.95'}</TtlAmt><Ccy>AUD</Ccy><AmtQlfr>ACTL</AmtQlfr></Tx>\n    </PmtReq>\n  </SvcReq>\n</SaleToPOISvcReq>`,
      diagnosis: `<SaleToPOISsnMgmtReq>\n  <Hdr>\n    <MsgFctn>SARQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SsnMgmtReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt/></Cntxt>\n    <SvcCntt>SMDQ</SvcCntt>\n    <DgnssReq><POIId><Id>${poiId}</Id></POIId></DgnssReq>\n  </SsnMgmtReq>\n</SaleToPOISsnMgmtReq>`,
      reconciliation: `<SaleToPOIRcncltnReq>\n  <Hdr>\n    <MsgFctn>FSCQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <RcncltnReq>\n    <RcncltnTp>SREC</RcncltnTp>\n  </RcncltnReq>\n</SaleToPOIRcncltnReq>`,
      logout: `<SaleToPOISsnMgmtReq>\n  <Hdr>\n    <MsgFctn>SARQ</MsgFctn>\n    <PrtcolVrsn>8.0</PrtcolVrsn>\n    <XchgId>${xid}</XchgId>\n    <CreDtTm>${dt}</CreDtTm>\n    <InitgPty><Id>${saleId}</Id></InitgPty>\n    <RcptPty><Id>${poiId}</Id></RcptPty>\n  </Hdr>\n  <SsnMgmtReq>\n    <Envt><Mrchnt><CmonNm>Test Merchant</CmonNm></Mrchnt></Envt>\n    <Cntxt><PmtCntxt/></Cntxt>\n    <SvcCntt>SMOQ</SvcCntt>\n    <LgotReq><MntncAllwd>true</MntncAllwd></LgotReq>\n  </SsnMgmtReq>\n</SaleToPOISsnMgmtReq>`,
    };
    return templates[name] || '';
  }

  // ═══ INIT ═══
  function init() {
    initEventHandlers();
    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
