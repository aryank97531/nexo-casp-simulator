/**
 * nexo CASP v8.0 Message Validator
 * Validates message structure against the v8 specification
 */
const { MessageFunction } = require('./constants');

class MessageValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  validate(msgFunction, json) {
    this.errors = [];
    this.warnings = [];

    // Common header validation
    this._validateHeader(json, msgFunction);

    // Message-specific validation
    switch (msgFunction) {
      case MessageFunction.FSPQ:
        this._validatePaymentRequest(json);
        break;
      case MessageFunction.FSRQ:
        this._validateReversalRequest(json);
        break;
      case MessageFunction.FSCQ:
        this._validateReconciliationRequest(json);
        break;
      case MessageFunction.SMIQ:
      case MessageFunction.SMOQ:
      case MessageFunction.SMDQ:
        this._validateSessionRequest(json, msgFunction);
        break;
      case MessageFunction.SSAB:
        this._validateAbort(json);
        break;
    }

    return {
      valid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings],
    };
  }

  _validateHeader(json, msgFunction) {
    const rootKey = Object.keys(json || {})[0];
    const root = json ? json[rootKey] : null;
    if (!root) { this.errors.push('Empty message'); return; }

    const hdr = root.Hdr;
    if (!hdr) { this.errors.push('Missing Header (Hdr)'); return; }
    if (!hdr.MsgFctn) this.errors.push('Header: Missing MessageFunction (MsgFctn)');
    if (!hdr.PrtcolVrsn) this.errors.push('Header: Missing ProtocolVersion (PrtcolVrsn)');
    else if (hdr.PrtcolVrsn !== '8.0') this.warnings.push(`Header: ProtocolVersion is ${hdr.PrtcolVrsn}, expected 8.0`);
    if (!hdr.XchgId) this.errors.push('Header: Missing ExchangeIdentification (XchgId)');
    if (!hdr.CreDtTm) this.errors.push('Header: Missing CreationDateTime (CreDtTm)');
    if (!hdr.InitgPty) this.errors.push('Header: Missing InitiatingParty (InitgPty)');
    if (!hdr.RcptPty) this.warnings.push('Header: Missing RecipientParty (RcptPty)');

    const expected = this._expectedHeaderFunction(rootKey, msgFunction);
    if (expected && hdr.MsgFctn && !expected.includes(hdr.MsgFctn)) {
      this.errors.push(`Header: MessageFunction ${hdr.MsgFctn} is invalid for ${rootKey}; expected ${expected.join(' or ')}`);
    }
  }

  _expectedHeaderFunction(rootKey, msgFunction) {
    const map = {
      SaleToPOISvcReq: ['SFSQ'],
      SaleToPOISvcRspn: ['SFSP'],
      SaleToPOISsnMgmtReq: ['SASQ'],
      SaleToPOISsnMgmtRspn: ['SASP'],
      SaleToPOIRcncltnReq: ['FSCQ'],
      SaleToPOIRcncltnRspn: ['FSCP'],
      SaleToPOIAbrt: ['SSAB'],
      SaleToPOIMsgStsReq: ['SSSQ'],
      SaleToPOIMsgStsRspn: ['SSSP'],
      SaleToPOIMsgRjctn: ['SSRR'],
    };

    if (rootKey === 'SaleToPOIDvcReq' || rootKey === 'SaleToPOIDvcRspn') {
      return msgFunction ? [msgFunction] : null;
    }
    return map[rootKey] || null;
  }

  _validatePaymentRequest(json) {
    const svc = json?.SaleToPOISvcReq?.SvcReq;
    if (!svc) { this.errors.push('Missing ServiceRequest (SvcReq)'); return; }
    if (svc.SvcCntt !== 'FSPQ') this.errors.push('ServiceContent must be FSPQ for Payment');
    if (!svc.PmtReq) { this.errors.push('Missing PaymentRequest (PmtReq)'); return; }
    const pmtReq = svc.PmtReq;
    if (!pmtReq.SaleTxId) this.errors.push('PaymentRequest: Missing SaleTransactionIdentification');
    if (!pmtReq.Tx) this.errors.push('PaymentRequest: Missing Transaction (Tx)');
    else {
      if (!pmtReq.Tx.TxTp) this.errors.push('Transaction: Missing TransactionType (TxTp)');
      if (!pmtReq.Tx.TtlAmt) this.errors.push('Transaction: Missing TotalAmount (TtlAmt)');
      if (!pmtReq.Tx.Ccy) this.warnings.push('Transaction: Missing Currency (Ccy)');
    }
  }

  _validateReversalRequest(json) {
    const svc = json?.SaleToPOISvcReq?.SvcReq;
    if (!svc) { this.errors.push('Missing ServiceRequest'); return; }
    if (!svc.RvslReq) { this.errors.push('Missing ReversalRequest (RvslReq)'); return; }
    if (!svc.RvslReq.OrgnlPOITx) this.errors.push('ReversalRequest: Missing OriginalPOITransaction');
    if (!svc.RvslReq.RvslRsn) this.errors.push('ReversalRequest: Missing ReversalReason');
  }

  _validateReconciliationRequest(json) {
    const req = json?.SaleToPOIRcncltnReq?.RcncltnReq;
    if (!req) { this.errors.push('Missing ReconciliationRequest'); return; }
    if (!req.RcncltnTp) this.errors.push('ReconciliationRequest: Missing ReconciliationType');
  }

  _validateSessionRequest(json, msgFunction) {
    const req = json?.SaleToPOISsnMgmtReq?.SsnMgmtReq;
    if (!req) { this.errors.push('Missing SessionManagementRequest'); return; }
    if (!req.SvcCntt) this.errors.push('SessionManagement: Missing ServiceContent');
    else if (req.SvcCntt !== msgFunction) this.errors.push(`SessionManagement: ServiceContent must be ${msgFunction}`);
    if (msgFunction === MessageFunction.SMIQ && !req.LgnReq) {
      this.errors.push('Login: Missing LoginRequest (LgnReq)');
    }
    if (msgFunction === MessageFunction.SMOQ && !req.LgotReq) {
      this.errors.push('Logout: Missing LogoutRequest (LgotReq)');
    }
    if (msgFunction === MessageFunction.SMDQ && !req.DgnssReq) {
      this.errors.push('Diagnosis: Missing DiagnosisRequest (DgnssReq)');
    }
  }

  _validateAbort(json) {
    const req = json?.SaleToPOIAbrt?.AbrtReq;
    if (!req) { this.errors.push('Missing AbortRequest'); return; }
    if (!req.AbrtRsn) this.errors.push('Abort: Missing AbortReason');
    if (!req.MsgRef) this.errors.push('Abort: Missing MessageReference');
  }
}

module.exports = { MessageValidator };
