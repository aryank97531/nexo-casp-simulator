/**
 * nexo CASP v8.0 POI Terminal Response Simulator
 * Generates realistic responses for each request type
 */
const {
  MessageFunction, ResponseCode, ResponseReason, TransactionType,
  ReconciliationType, CardProfiles, DefaultConfig,
} = require('./constants');
const { isoDateTime, xmlBuilder, genExchangeId } = require('./protocol');

class POISimulator {
  constructor(config = {}) {
    this.config = { ...DefaultConfig, ...config };
    this.loggedIn = false;
    this.reconciliationId = 'RECON-001';
    this.reconciliationCounter = 1;
    this.transactionCounter = 0;
    this.selectedCard = CardProfiles.VISA_CREDIT;
    this.totals = { CRDT: { count: 0, amount: 0 }, DEBT: { count: 0, amount: 0 },
      CRDR: { count: 0, amount: 0 }, DBTR: { count: 0, amount: 0 },
      DECL: { count: 0, amount: 0 }, FAIL: { count: 0, amount: 0 } };
    this.forceDecline = false;
    this.forceTimeout = false;
  }

  setCard(profileName) {
    if (CardProfiles[profileName]) this.selectedCard = CardProfiles[profileName];
  }

  /** Generate response for any incoming request */
  async processRequest(msgFunction, requestJson, exchangeId) {
    const steps = [];
    let response;

    switch (msgFunction) {
      case MessageFunction.SMIQ:
        response = this.handleLogin(requestJson, exchangeId);
        break;
      case MessageFunction.SMOQ:
        response = this.handleLogout(requestJson, exchangeId);
        break;
      case MessageFunction.SMDQ:
        response = this.handleDiagnosis(requestJson, exchangeId);
        break;
      case MessageFunction.FSPQ:
        if (!this.loggedIn) return this.handleLoginRequired(msgFunction, exchangeId);
        return this.handlePayment(requestJson, exchangeId);
      case MessageFunction.FSRQ:
        if (!this.loggedIn) return this.handleLoginRequired(msgFunction, exchangeId);
        response = this.handleReversal(requestJson, exchangeId);
        break;
      case MessageFunction.FSIQ:
        if (!this.loggedIn) return this.handleLoginRequired(msgFunction, exchangeId);
        response = this.handleBalanceInquiry(requestJson, exchangeId);
        break;
      case MessageFunction.FSCQ:
        if (!this.loggedIn) return this.handleLoginRequired(msgFunction, exchangeId);
        response = this.handleReconciliation(requestJson, exchangeId);
        break;
      case MessageFunction.SSAB:
        response = this.handleAbort(requestJson, exchangeId);
        break;
      case MessageFunction.SSSQ:
        response = this.handleMessageStatus(requestJson, exchangeId);
        break;
      default:
        response = this.handleUnsupported(msgFunction, exchangeId);
    }
    return { steps: [], response };
  }

  // ── LOGIN ──
  handleLogin(req, exchangeId) {
    this.loggedIn = true;
    const msg = {
      SaleToPOISsnMgmtRspn: {
        Hdr: this._responseHeader(MessageFunction.SASP, exchangeId),
        SsnMgmtRspn: {
          Envt: { Mrchnt: { CmonNm: this.config.merchantName } },
          Cntxt: { PmtCntxt: { AttndncCntxt: this.config.attendanceContext } },
          SvcCntt: 'SMIP',
          LgnRspn: {
            POIDtTm: isoDateTime(),
            POISftwr: {
              ManfctrId: 'NexoSimulator', CmpntTp: 'SOFT',
              Id: { Id: 'POI-SIM-v8.0' }, Vrsn: '8.0.0',
            },
            POICpblties: {
              PrtFlg: 'true', CrdRdrTp: 'CICC',
              PINLngthCpblties: '12', ApprvlCdLngth: '6',
            },
          },
          Rspn: { Rspn: ResponseCode.SUCC },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.SMIP,
      displayText: 'LOGIN SUCCESSFUL', status: 'success' };
  }

  // ── LOGOUT ──
  handleLogout(req, exchangeId) {
    this.loggedIn = false;
    const msg = {
      SaleToPOISsnMgmtRspn: {
        Hdr: this._responseHeader(MessageFunction.SASP, exchangeId),
        SsnMgmtRspn: {
          Envt: { Mrchnt: { CmonNm: this.config.merchantName } },
          Cntxt: { PmtCntxt: {} },
          SvcCntt: 'SMOP',
          Rspn: { Rspn: ResponseCode.SUCC },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.SMOP,
      displayText: 'LOGOUT OK', status: 'success' };
  }

  // ── DIAGNOSIS ──
  handleDiagnosis(req, exchangeId) {
    const msg = {
      SaleToPOISsnMgmtRspn: {
        Hdr: this._responseHeader(MessageFunction.SASP, exchangeId),
        SsnMgmtRspn: {
          Envt: { Mrchnt: { CmonNm: this.config.merchantName } },
          Cntxt: { PmtCntxt: { AttndncCntxt: this.config.attendanceContext } },
          SvcCntt: 'SMDP',
          DgnssRspn: {
            POISts: {
              POIDtTm: isoDateTime(),
              AttndncCntxt: this.config.attendanceContext,
              POICpblties: { PrtFlg: 'true', CrdRdrTp: 'CICC' },
              POICmpnt: [
                { CmpntTp: 'TERM', ManfctrId: 'NexoSimulator', Mdl: 'SIM-8000', SrlNb: 'SN00001', Vrsn: '8.0' },
                { CmpntTp: 'SOFT', ManfctrId: 'NexoSimulator', Id: { Id: 'APP' }, Vrsn: '8.0.0' },
              ],
            },
          },
          Rspn: { Rspn: ResponseCode.SUCC },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.SMDP,
      displayText: 'POI STATUS: OK', status: 'success' };
  }

  handleLoginRequired(msgFunction, exchangeId) {
    if (msgFunction === MessageFunction.FSCQ) {
      const msg = {
        SaleToPOIRcncltnRspn: {
          Hdr: this._responseHeader(MessageFunction.FSCP, exchangeId),
          RcncltnRspn: {
            RcncltnTp: ReconciliationType.SREC,
          },
          Rspn: { Rspn: ResponseCode.FAIL, RspnRsn: ResponseReason.LOGN },
        },
      };
      return { steps: [], response: { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.FSCP,
        displayText: 'LOGIN REQUIRED', status: 'error' } };
    }

    const responseMap = {
      [MessageFunction.FSPQ]: MessageFunction.FSPP,
      [MessageFunction.FSRQ]: MessageFunction.FSRP,
      [MessageFunction.FSIQ]: MessageFunction.FSIP,
    };
    const svcCntt = responseMap[msgFunction] || MessageFunction.FSPP;
    const msg = {
      SaleToPOISvcRspn: {
        Hdr: this._responseHeader(MessageFunction.SFSP, exchangeId),
        SvcRspn: {
          Envt: this._responseEnv(),
          Cntxt: { PmtCntxt: {} },
          SvcCntt: svcCntt,
          Rspn: { Rspn: ResponseCode.FAIL, RspnRsn: ResponseReason.LOGN },
        },
      },
    };
    return { steps: [], response: { xml: xmlBuilder.build(msg), json: msg, msgFunction: svcCntt,
      displayText: 'LOGIN REQUIRED', status: 'error' } };
  }

  // ── PAYMENT (multi-step with device messages) ──
  handlePayment(req, exchangeId) {
    this.transactionCounter++;
    const poiTxId = `POI-${Date.now()}-${this.transactionCounter}`;
    const card = this.selectedCard;
    const amount = this._extractAmount(req) || '100.00';
    const isDecline = this.forceDecline || parseFloat(amount) > 99999;

    // Build device steps (Display, SecureInput, Display, then final response)
    const steps = [];

    // Step 1: Display "Present Card"
    steps.push({
      delay: 300,
      message: this._buildDeviceDisplay('PRESENT CARD', exchangeId, 'CDSP'),
      displayText: 'PRESENT CARD',
      msgFunction: MessageFunction.DDYQ,
    });

    // Step 2: Display "Processing..."
    steps.push({
      delay: 1200,
      message: this._buildDeviceDisplay(`${card.brand} - ${card.cardType}`, exchangeId, 'MDSP'),
      displayText: `${card.brand} ${card.cardType}`,
      msgFunction: MessageFunction.DDYQ,
    });

    // Step 3: PIN entry (SecureInput)
    if (card.entryMode === 'CICC' || card.entryMode === 'ECTL') {
      steps.push({
        delay: 800,
        message: this._buildSecureInputRequest(exchangeId),
        displayText: 'ENTER PIN',
        msgFunction: MessageFunction.DSIQ,
        requiresInput: true,
      });
    }

    // Step 4: Display "Authorising..."
    steps.push({
      delay: 1000,
      message: this._buildDeviceDisplay('AUTHORISING...', exchangeId, 'CDSP'),
      displayText: 'AUTHORISING...',
      msgFunction: MessageFunction.DDYQ,
    });

    // Step 5: Final payment response
    const rspnCode = isDecline ? ResponseCode.FAIL : ResponseCode.SUCC;
    const rspnReason = isDecline ? ResponseReason.DCLN : undefined;
    const approvalCode = isDecline ? undefined : this._genApprovalCode();

    // Update totals
    if (!isDecline) {
      const txType = this._extractTxType(req);
      if (txType === TransactionType.RFND) {
        this.totals.CRDT.count++;
        this.totals.CRDT.amount += parseFloat(amount);
      } else {
        this.totals.DEBT.count++;
        this.totals.DEBT.amount += parseFloat(amount);
      }
    } else {
      this.totals.DECL.count++;
      this.totals.DECL.amount += parseFloat(amount);
    }

    const paymentResponse = this._buildPaymentResponse(exchangeId, {
      rspnCode, rspnReason, approvalCode, amount, card, poiTxId,
    });

    // Step 6: Print receipt
    const receiptStep = {
      delay: 500,
      message: this._buildPrintRequest(exchangeId, {
        approved: !isDecline, amount, card, approvalCode, poiTxId,
      }),
      displayText: isDecline ? 'DECLINED' : 'APPROVED',
      msgFunction: MessageFunction.DPRQ,
    };

    return {
      steps,
      response: {
        ...paymentResponse,
        displayText: isDecline ? 'DECLINED' : `APPROVED ${approvalCode}`,
        status: isDecline ? 'declined' : 'success',
      },
      receiptStep,
    };
  }

  // ── REVERSAL ──
  handleReversal(req, exchangeId) {
    const amount = this._extractReversalAmount(req) || '0.00';
    const msg = {
      SaleToPOISvcRspn: {
        Hdr: this._responseHeader(MessageFunction.SFSP, exchangeId),
        SvcRspn: {
          Envt: this._responseEnv(),
          Cntxt: { PmtCntxt: {} },
          SvcCntt: 'FSRP',
          RvslRspn: {
            POITxId: { TxId: `POI-REV-${Date.now()}`, TxDtTm: isoDateTime() },
            OrgnlPOITx: { POITxId: { TxId: 'ORIGINAL', TxDtTm: isoDateTime() } },
            RvsdAmt: amount,
          },
          Rspn: { Rspn: ResponseCode.SUCC },
        },
      },
    };
    // Adjust totals
    this.totals.DBTR.count++;
    this.totals.DBTR.amount += parseFloat(amount);
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.FSRP,
      displayText: `REVERSAL OK $${amount}`, status: 'success' };
  }

  // ── BALANCE INQUIRY ──
  handleBalanceInquiry(req, exchangeId) {
    const balance = (Math.random() * 10000).toFixed(2);
    const msg = {
      SaleToPOISvcRspn: {
        Hdr: this._responseHeader(MessageFunction.SFSP, exchangeId),
        SvcRspn: {
          Envt: this._responseEnv(),
          Cntxt: { PmtCntxt: {} },
          SvcCntt: 'FSIP',
          BalNqryRspn: {
            POITxId: { TxId: `POI-BAL-${Date.now()}`, TxDtTm: isoDateTime() },
            AvlblBal: balance,
            Ccy: this.config.currency,
          },
          Rspn: { Rspn: ResponseCode.SUCC },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.FSIP,
      displayText: `BALANCE: $${balance}`, status: 'success' };
  }

  // ── RECONCILIATION ──
  handleReconciliation(req, exchangeId) {
    const reconId = `RECON-${String(this.reconciliationCounter++).padStart(3, '0')}`;
    const txTotals = [];
    for (const [type, data] of Object.entries(this.totals)) {
      if (data.count > 0) {
        txTotals.push({
          POIGrpId: this.config.poiId, Tp: type,
          TtlNb: String(data.count), CmltvAmt: data.amount.toFixed(2),
        });
      }
    }
    const msg = {
      SaleToPOIRcncltnRspn: {
        Hdr: this._responseHeader(MessageFunction.FSCP, exchangeId),
        RcncltnRspn: {
          RcncltnTp: ReconciliationType.SREC,
          POIRcncltnId: reconId,
          TxTtls: txTotals.length ? txTotals : [
            { POIGrpId: this.config.poiId, Tp: 'DEBT', TtlNb: '0', CmltvAmt: '0.00' },
          ],
        },
        Rspn: { Rspn: ResponseCode.SUCC },
      },
    };
    // Reset totals
    for (const key of Object.keys(this.totals)) {
      this.totals[key] = { count: 0, amount: 0 };
    }
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.FSCP,
      displayText: `RECONCILIATION ${reconId}`, status: 'success' };
  }

  // ── ABORT ──
  handleAbort(req, exchangeId) {
    return { xml: '', json: {}, msgFunction: MessageFunction.SSAB,
      displayText: 'ABORTED', status: 'info' };
  }

  // ── MESSAGE STATUS ──
  handleMessageStatus(req, exchangeId) {
    const msg = {
      SaleToPOIMsgStsRspn: {
        Hdr: this._responseHeader(MessageFunction.SSSP, exchangeId),
        MsgStsRspn: {
          Rspn: { Rspn: ResponseCode.SUCC },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.SSSP,
      displayText: 'STATUS: COMPLETE', status: 'success' };
  }

  handleUnsupported(msgFunction, exchangeId) {
    const msg = {
      SaleToPOIMsgRjctn: {
        Hdr: this._responseHeader(MessageFunction.SSRR, exchangeId),
        MsgRjctn: {
          RjctdMsgFctn: msgFunction,
          RjctRsn: 'NSUP',
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.SSRR,
      displayText: 'NOT SUPPORTED', status: 'error' };
  }

  // ── Internal helpers ──
  _responseHeader(msgFunction, exchangeId) {
    return {
      MsgFctn: msgFunction, PrtcolVrsn: this.config.protocolVersion,
      XchgId: exchangeId, CreDtTm: isoDateTime(),
      InitgPty: { Id: this.config.poiId },
      RcptPty: { Id: this.config.saleId },
    };
  }

  _responseEnv() {
    return {
      Mrchnt: { CmonNm: this.config.merchantName },
      Card: {
        PlainCardData: {
          PAN: this._maskPan(this.selectedCard.pan),
          XpryDt: this.selectedCard.expiry,
          CardBrnd: this.selectedCard.brand,
        },
      },
    };
  }

  _buildPaymentResponse(exchangeId, opts) {
    const msg = {
      SaleToPOISvcRspn: {
        Hdr: this._responseHeader(MessageFunction.SFSP, exchangeId),
        SvcRspn: {
          Envt: this._responseEnv(),
          Cntxt: { PmtCntxt: { CardDataNtryMd: opts.card.entryMode } },
          SvcCntt: 'FSPP',
          PmtRspn: {
            POITxId: { TxId: opts.poiTxId, TxDtTm: isoDateTime() },
            SaleTxId: { TxId: `SALE-${exchangeId}`, TxDtTm: isoDateTime() },
            Tx: {
              TxTp: TransactionType.CRDP,
              TtlAmt: opts.amount,
              Ccy: this.config.currency,
            },
            AuthstnRslt: opts.approvalCode ? {
              AuthstnCd: opts.approvalCode,
              CmpltdFlg: 'true',
            } : undefined,
            POIRcncltnId: this.reconciliationId,
          },
          Rspn: {
            Rspn: opts.rspnCode,
            RspnRsn: opts.rspnReason,
          },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, msgFunction: MessageFunction.FSPP };
  }

  _buildDeviceDisplay(text, exchangeId, destination) {
    const msg = {
      SaleToPOIDvcReq: {
        Hdr: this._responseHeader(MessageFunction.DDYQ, genExchangeId()),
        DvcReq: {
          SvcCntt: 'DDYQ',
          DispReq: {
            DispOutpt: {
              MsgDstn: destination, InfQlfr: 'STAT', Frmt: 'TEXT', MsgCntt: text,
            },
          },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg };
  }

  _buildSecureInputRequest(exchangeId) {
    const msg = {
      SaleToPOIDvcReq: {
        Hdr: this._responseHeader(MessageFunction.DSIQ, genExchangeId()),
        DvcReq: {
          SvcCntt: 'DSIQ',
          ScrInptReq: {
            MsgDstn: 'CDSP',
            MaxInptTm: '30',
            InptCmd: 'PINP',
            MsgCntt: 'ENTER PIN',
            PINReqTp: 'PINP',
            MaxPINLngth: '12',
            MinPINLngth: '4',
          },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg };
  }

  _buildPrintRequest(exchangeId, opts) {
    const dt = new Date();
    const dateStr = dt.toLocaleDateString('en-AU');
    const timeStr = dt.toLocaleTimeString('en-AU');
    const receipt = [
      '================================',
      `  ${this.config.merchantName}`,
      '================================',
      `Date: ${dateStr}  Time: ${timeStr}`,
      `Terminal: ${this.config.poiId}`,
      `Txn: ${opts.poiTxId}`,
      `Card: ${opts.card.brand}`,
      `PAN: ${this._maskPan(opts.card.pan)}`,
      `Entry: ${opts.card.entryMode}`,
      '--------------------------------',
      `Amount:          $${parseFloat(opts.amount).toFixed(2)}`,
      '--------------------------------',
      opts.approved ? `APPROVED  Code: ${opts.approvalCode}` : 'DECLINED',
      '================================',
    ].join('\n');

    const msg = {
      SaleToPOIDvcReq: {
        Hdr: this._responseHeader(MessageFunction.DPRQ, genExchangeId()),
        DvcReq: {
          SvcCntt: 'DPRQ',
          PrtReq: {
            PrtOutpt: {
              MsgDstn: 'MRCP', InfQlfr: 'RCPT', Frmt: 'TEXT', MsgCntt: receipt,
            },
          },
        },
      },
    };
    return { xml: xmlBuilder.build(msg), json: msg, receipt };
  }

  _maskPan(pan) {
    if (!pan || pan.length < 8) return pan;
    return pan.slice(0, 6) + '****' + pan.slice(-4);
  }

  _genApprovalCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  _extractAmount(req) {
    try {
      const svc = req?.SaleToPOISvcReq?.SvcReq;
      return svc?.PmtReq?.Tx?.TtlAmt || null;
    } catch { return null; }
  }

  _extractTxType(req) {
    try {
      return req?.SaleToPOISvcReq?.SvcReq?.PmtReq?.Tx?.TxTp || TransactionType.CRDP;
    } catch { return TransactionType.CRDP; }
  }

  _extractReversalAmount(req) {
    try {
      return req?.SaleToPOISvcReq?.SvcReq?.RvslReq?.RvsdAmt || '0.00';
    } catch { return '0.00'; }
  }
}

module.exports = { POISimulator };
