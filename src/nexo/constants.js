/**
 * nexo CASP v8.0 Protocol Constants
 * All code sets and enumerations from the Message Usage Guide v8
 */
const PROTOCOL_VERSION = '8.0';

const MessageFunction = {
  SFSQ: 'SFSQ', SFSP: 'SFSP',
  FSPQ: 'FSPQ', FSPP: 'FSPP', FSRQ: 'FSRQ', FSRP: 'FSRP',
  FSIQ: 'FSIQ', FSIP: 'FSIP', FSCQ: 'FSCQ', FSCP: 'FSCP',
  FSLQ: 'FSLQ', FSLP: 'FSLP', FSVQ: 'FSVQ', FSVP: 'FSVP',
  FSBQ: 'FSBQ', FSBP: 'FSBP', FSEQ: 'FSEQ', FSEP: 'FSEP',
  FSAQ: 'FSAQ', FSAP: 'FSAP',
  SMIQ: 'SMIQ', SMIP: 'SMIP', SMOQ: 'SMOQ', SMOP: 'SMOP',
  SMDQ: 'SMDQ', SMDP: 'SMDP', ADAQ: 'ADAQ', ADAP: 'ADAP',
  RPTQ: 'RPTQ', RPTP: 'RPTP', RPAQ: 'RPAQ', RPAP: 'RPAP',
  SSAB: 'SSAB', SSEN: 'SSEN', SSRR: 'SSRR', SSSQ: 'SSSQ', SSSP: 'SSSP',
  SASQ: 'SASQ', SASP: 'SASP', SARQ: 'SARQ', SARP: 'SARP',
  DDYQ: 'DDYQ', DDYP: 'DDYP', DINQ: 'DINQ', DINP: 'DINP',
  DPRQ: 'DPRQ', DPRP: 'DPRP', DSIQ: 'DSIQ', DSIP: 'DSIP',
  DCIQ: 'DCIQ', DCIP: 'DCIP', DCOQ: 'DCOQ', DCOP: 'DCOP',
  DINO: 'DINO',
};

const ServiceContentNames = {
  FSPQ: 'Payment Request', FSPP: 'Payment Response',
  FSRQ: 'Reversal Request', FSRP: 'Reversal Response',
  FSIQ: 'Balance Inquiry Req', FSIP: 'Balance Inquiry Resp',
  FSCQ: 'Reconciliation Req', FSCP: 'Reconciliation Resp',
  SMIQ: 'Login Request', SMIP: 'Login Response',
  SMOQ: 'Logout Request', SMOP: 'Logout Response',
  SMDQ: 'Diagnosis Request', SMDP: 'Diagnosis Response',
  ADAQ: 'Admin Request', ADAP: 'Admin Response',
  SSAB: 'Abort', SSEN: 'Event Notification', SSRR: 'Message Rejection',
  SSSQ: 'Msg Status Request', SSSP: 'Msg Status Response',
  DDYQ: 'Display Request', DDYP: 'Display Response',
  DSIQ: 'Secure Input Request', DSIP: 'Secure Input Response',
  DPRQ: 'Print Request', DPRP: 'Print Response',
};

const ResponseCode = { SUCC: 'SUCC', FAIL: 'FAIL', WARN: 'WARN', PART: 'PART' };

const ResponseReason = {
  BUSY: 'BUSY', CANC: 'CANC', DCLN: 'DCLN', FMTE: 'FMTE',
  LOGN: 'LOGN', MALF: 'MALF', NSUP: 'NSUP', TNFD: 'TNFD',
  UNAB: 'UNAB', WIPG: 'WIPG', ABRT: 'ABRT', AUTH: 'AUTH',
};

const TransactionType = {
  CRDP: 'CRDP', RFND: 'RFND', CSHW: 'CSHW', CSHD: 'CSHD',
  RESA: 'RESA', DEFR: 'DEFR', BALC: 'BALC', VALC: 'VALC',
};

const PaymentType = {
  CRDP: 'CRDP', CSHW: 'CSHW', IRES: 'IRES', DEFR: 'DEFR',
  URES: 'URES', PRES: 'PRES', RECP: 'RECP', INSP: 'INSP', RFND: 'RFND',
};

const ReconciliationType = {
  SREC: 'SREC', ASYN: 'ASYN', AREC: 'AREC', PREC: 'PREC',
};

const CardDataReading = {
  PHYS: 'PHYS', MGST: 'MGST', CICC: 'CICC', CTLS: 'CTLS', ECTL: 'ECTL', QRCD: 'QRCD',
};

const ReversalReason = {
  CUSC: 'CUSC', MALF: 'MALF', MERC: 'MERC', UNAB: 'UNAB',
};

const MessageDestination = {
  CDSP: 'CDSP', CRCP: 'CRCP', MDSP: 'MDSP', MRCP: 'MRCP',
};

const InformationQualifier = {
  DISP: 'DISP', RCPT: 'RCPT', STAT: 'STAT', ERRO: 'ERRO', INPT: 'INPT',
};

const AttendanceContext = { ATTD: 'ATTD', SATT: 'SATT', UATT: 'UATT' };

const TransactionTotalsType = {
  CRDT: 'CRDT', CRDR: 'CRDR', DEBT: 'DEBT', DBTR: 'DBTR', DECL: 'DECL', FAIL: 'FAIL',
};

const CardProfiles = {
  VISA_CREDIT: {
    brand: 'Visa', pan: '4111111111111111', expiry: '2712',
    cardholderName: 'JOHN DOE', entryMode: 'CICC', aid: 'A0000000031010', cardType: 'Credit',
  },
  VISA_DEBIT: {
    brand: 'Visa Debit', pan: '4000056655665556', expiry: '2805',
    cardholderName: 'JANE SMITH', entryMode: 'ECTL', aid: 'A0000000032010', cardType: 'Debit',
  },
  MASTERCARD_CREDIT: {
    brand: 'Mastercard', pan: '5425233430109903', expiry: '2804',
    cardholderName: 'ROBERT WILSON', entryMode: 'CICC', aid: 'A0000000041010', cardType: 'Credit',
  },
  MASTERCARD_CONTACTLESS: {
    brand: 'Mastercard', pan: '2222420000001113', expiry: '2806',
    cardholderName: 'ALICE BROWN', entryMode: 'ECTL', aid: 'A0000000041010', cardType: 'Credit',
  },
  AMEX: {
    brand: 'American Express', pan: '374245455400126', expiry: '2712',
    cardholderName: 'CHARLES MARTIN', entryMode: 'CICC', aid: 'A00000002501', cardType: 'Credit',
  },
  EFTPOS: {
    brand: 'eftpos', pan: '5076801234567890', expiry: '2809',
    cardholderName: 'SARAH JONES', entryMode: 'CICC', aid: 'A000000384', cardType: 'Debit',
  },
};

const DefaultConfig = {
  saleId: 'SaleTerminal01', poiId: 'POITerminal01', protocolVersion: PROTOCOL_VERSION,
  merchantName: 'Test Merchant Pty Ltd', merchantCategoryCode: '5411',
  merchantCountry: '036', currency: 'AUD', currencyCode: '036', currencyDecimals: 2,
  attendanceContext: AttendanceContext.ATTD, responseDelay: 1500, autoRespond: true,
  terminalMode: 'auto', physicalTcpHost: '0.0.0.0', physicalTcpPort: 9101,
};

module.exports = {
  PROTOCOL_VERSION, MessageFunction, ServiceContentNames, ResponseCode, ResponseReason,
  TransactionType, PaymentType, ReconciliationType, CardDataReading, ReversalReason,
  MessageDestination, InformationQualifier, AttendanceContext, TransactionTotalsType,
  CardProfiles, DefaultConfig,
};
