/**
 * nexo CASP v8.0 Protocol Engine — Message Builder
 * Builds compliant XML messages for all supported message types
 */
const { XMLBuilder } = require('fast-xml-parser');
const { v4: uuidv4 } = require('uuid');
const {
  PROTOCOL_VERSION, MessageFunction, TransactionType, PaymentType,
  ReconciliationType, CardDataReading, ReversalReason, MessageDestination,
  InformationQualifier, AttendanceContext, DefaultConfig,
} = require('./constants');

const xmlBuilder = new XMLBuilder({
  format: true, ignoreAttributes: false, attributeNamePrefix: '@_',
  suppressEmptyNode: true, indentBy: '  ',
});

function isoDateTime() {
  return new Date().toISOString();
}

function genExchangeId() {
  return uuidv4().split('-')[0].toUpperCase();
}

/** Build a Header41 component */
function buildHeader(msgFunction, config, exchangeId) {
  return {
    MsgFctn: msgFunction,
    PrtcolVrsn: config.protocolVersion || PROTOCOL_VERSION,
    XchgId: exchangeId || genExchangeId(),
    CreDtTm: isoDateTime(),
    InitgPty: { Id: config.saleId || DefaultConfig.saleId },
    RcptPty: { Id: config.poiId || DefaultConfig.poiId },
  };
}

/** Build Environment component */
function buildEnvironment(config) {
  const env = {
    Mrchnt: {
      CmonNm: config.merchantName || DefaultConfig.merchantName,
      LctnCtgy: 'FIXD',
    },
  };
  if (config.acquirerId) {
    env.Acqrr = { Id: { Id: config.acquirerId } };
  }
  return env;
}

/** Build Context component */
function buildContext(config, options = {}) {
  const ctx = {
    PmtCntxt: {
      AttndncCntxt: config.attendanceContext || DefaultConfig.attendanceContext,
      CrdhldrPres: options.cardholderPresent !== false ? 'true' : 'false',
      CardPres: options.cardPresent !== false ? 'true' : 'false',
    },
    SaleCntxt: {},
  };
  if (options.forceOnline) ctx.SaleCntxt.ForceOnlnFlg = 'true';
  return ctx;
}

// ═══════════════════════════════════════════════════
// FINANCIAL SERVICE MESSAGES (casp.001 / casp.002)
// ═══════════════════════════════════════════════════

/** Build PaymentRequest (FSPQ) */
function buildPaymentRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const amount = params.amount || '100.00';
  const currency = params.currency || config.currency || DefaultConfig.currency;
  const txType = params.transactionType || TransactionType.CRDP;
  const paymentType = params.paymentType || PaymentType.CRDP;

  const msg = {
    SaleToPOISvcReq: {
      Hdr: buildHeader(MessageFunction.FSPQ, config, exchangeId),
      SvcReq: {
        Envt: buildEnvironment(config),
        Cntxt: buildContext(config, params),
        SvcCntt: 'FSPQ',
        PmtReq: {
          SaleTxId: {
            TxId: `SALE-${exchangeId}`,
            TxDtTm: isoDateTime(),
          },
          PmtTp: paymentType,
          Tx: {
            TxTp: txType,
            TtlAmt: amount,
            Ccy: currency,
            AmtQlfr: 'ACTL',
          },
        },
      },
    },
  };

  if (params.cashback) {
    msg.SaleToPOISvcReq.SvcReq.PmtReq.Tx.CshBckAmt = params.cashback;
  }
  if (params.gratuity) {
    msg.SaleToPOISvcReq.SvcReq.PmtReq.Tx.AddtlSvc = 'GRTT';
    msg.SaleToPOISvcReq.SvcReq.PmtReq.Tx.GrttyAmt = params.gratuity;
  }

  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.FSPQ };
}

/** Build ReversalRequest (FSRQ) */
function buildReversalRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOISvcReq: {
      Hdr: buildHeader(MessageFunction.FSRQ, config, exchangeId),
      SvcReq: {
        Envt: buildEnvironment(config),
        Cntxt: buildContext(config, params),
        SvcCntt: 'FSRQ',
        RvslReq: {
          OrgnlPOITx: {
            SaleId: config.saleId || DefaultConfig.saleId,
            POIId: config.poiId || DefaultConfig.poiId,
            POITxId: {
              TxId: params.originalTxId || 'UNKNOWN',
              TxDtTm: params.originalTxDateTime || isoDateTime(),
            },
          },
          Tx: {
            TxTp: TransactionType.CRDP,
          },
          RvslRsn: params.reversalReason || ReversalReason.MERC,
          RvsdAmt: params.reversedAmount || params.amount || '0',
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.FSRQ };
}

/** Build BalanceInquiryRequest (FSIQ) */
function buildBalanceInquiryRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOISvcReq: {
      Hdr: buildHeader(MessageFunction.FSIQ, config, exchangeId),
      SvcReq: {
        Envt: buildEnvironment(config),
        Cntxt: buildContext(config, params),
        SvcCntt: 'FSIQ',
        BalNqryReq: {
          SaleTxId: {
            TxId: `BAL-${exchangeId}`,
            TxDtTm: isoDateTime(),
          },
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.FSIQ };
}

// ═══════════════════════════════════════════════════
// RECONCILIATION (casp.003 / casp.004)
// ═══════════════════════════════════════════════════

function buildReconciliationRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const reconcType = params.reconciliationType || ReconciliationType.SREC;
  const msg = {
    SaleToPOIRcncltnReq: {
      Hdr: buildHeader(MessageFunction.FSCQ, config, exchangeId),
      RcncltnReq: {
        RcncltnTp: reconcType,
      },
    },
  };
  if (reconcType !== ReconciliationType.AREC && params.poiReconciliationId) {
    msg.SaleToPOIRcncltnReq.RcncltnReq.POIRcncltnId = params.poiReconciliationId;
  }
  if (params.acquirerIds && params.acquirerIds.length) {
    msg.SaleToPOIRcncltnReq.RcncltnReq.AcqrrId = params.acquirerIds.map(id => ({ Id: { Id: id } }));
  }
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.FSCQ };
}

// ═══════════════════════════════════════════════════
// SESSION MANAGEMENT (casp.005 / casp.006)
// ═══════════════════════════════════════════════════

function buildLoginRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOISsnMgmtReq: {
      Hdr: buildHeader(MessageFunction.SARQ, config, exchangeId),
      SsnMgmtReq: {
        Envt: buildEnvironment(config),
        Cntxt: buildContext(config, params),
        SvcCntt: 'SMIQ',
        LgnReq: {
          DtTm: isoDateTime(),
          SaleSftwr: {
            ManfctrId: 'NexoSimulator',
            CmpntTp: 'SOFT',
            Id: { Id: 'nexo-sim-v1' },
          },
          SaleTermnlData: {
            TtlNbOfSaleTermnls: '1',
            SaleCpblties: {
              PrtFlg: 'true',
              CshHndlg: 'false',
            },
          },
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.SMIQ };
}

function buildLogoutRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOISsnMgmtReq: {
      Hdr: buildHeader(MessageFunction.SARQ, config, exchangeId),
      SsnMgmtReq: {
        Envt: buildEnvironment(config),
        Cntxt: buildContext(config),
        SvcCntt: 'SMOQ',
        LgotReq: {
          MntncAllwd: params.maintenanceAllowed !== false ? 'true' : 'false',
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.SMOQ };
}

function buildDiagnosisRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOISsnMgmtReq: {
      Hdr: buildHeader(MessageFunction.SARQ, config, exchangeId),
      SsnMgmtReq: {
        Envt: buildEnvironment(config),
        Cntxt: buildContext(config),
        SvcCntt: 'SMDQ',
        DgnssReq: {
          POIId: { Id: config.poiId || DefaultConfig.poiId },
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.SMDQ };
}

// ═══════════════════════════════════════════════════
// SYSTEM SERVICES (casp.011-015)
// ═══════════════════════════════════════════════════

function buildAbortRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOIAbrt: {
      Hdr: buildHeader(MessageFunction.SSAB, config, exchangeId),
      AbrtReq: {
        AbrtRsn: params.abortReason || 'CUSC',
        MsgRef: {
          MsgFctn: params.originalMsgFunction || MessageFunction.FSPQ,
          SaleId: config.saleId || DefaultConfig.saleId,
          POIId: config.poiId || DefaultConfig.poiId,
          XchgId: params.originalExchangeId || 'UNKNOWN',
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.SSAB };
}

function buildMessageStatusRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOIMsgStsReq: {
      Hdr: buildHeader(MessageFunction.SSSQ, config, exchangeId),
      MsgStsReq: {
        MsgRef: {
          MsgFctn: params.originalMsgFunction || MessageFunction.FSPQ,
          SaleId: config.saleId || DefaultConfig.saleId,
          POIId: config.poiId || DefaultConfig.poiId,
          XchgId: params.originalExchangeId || 'UNKNOWN',
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.SSSQ };
}

// ═══════════════════════════════════════════════════
// DEVICE SERVICES (casp.016/017)
// ═══════════════════════════════════════════════════

function buildDisplayRequest(config, params = {}) {
  const exchangeId = genExchangeId();
  const msg = {
    SaleToPOIDvcReq: {
      Hdr: buildHeader(MessageFunction.DDYQ, config, exchangeId),
      DvcReq: {
        SvcCntt: 'DDYQ',
        DispReq: {
          DispOutpt: {
            MsgDstn: params.destination || MessageDestination.CDSP,
            InfQlfr: params.qualifier || InformationQualifier.DISP,
            Frmt: 'TEXT',
            MsgCntt: params.message || 'Please wait...',
          },
        },
      },
    },
  };
  return { xml: xmlBuilder.build(msg), json: msg, exchangeId, msgFunction: MessageFunction.DDYQ };
}

// Export all builders
module.exports = {
  buildHeader, buildEnvironment, buildContext,
  buildPaymentRequest, buildReversalRequest, buildBalanceInquiryRequest,
  buildReconciliationRequest,
  buildLoginRequest, buildLogoutRequest, buildDiagnosisRequest,
  buildAbortRequest, buildMessageStatusRequest,
  buildDisplayRequest,
  isoDateTime, genExchangeId, xmlBuilder,
};
