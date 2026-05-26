const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/nexo/protocol');
const { MessageValidator } = require('../src/nexo/validator');
const { DefaultConfig } = require('../src/nexo/constants');

test('builders emit CASP wrapper header functions with service content routing codes', () => {
  const validator = new MessageValidator();
  const cases = [
    [protocol.buildPaymentRequest(DefaultConfig, { amount: '12.34' }), 'SaleToPOISvcReq', 'SFSQ', 'FSPQ'],
    [protocol.buildReversalRequest(DefaultConfig, { amount: '12.34' }), 'SaleToPOISvcReq', 'SFSQ', 'FSRQ'],
    [protocol.buildBalanceInquiryRequest(DefaultConfig), 'SaleToPOISvcReq', 'SFSQ', 'FSIQ'],
    [protocol.buildReconciliationRequest(DefaultConfig), 'SaleToPOIRcncltnReq', 'FSCQ', null],
    [protocol.buildLoginRequest(DefaultConfig), 'SaleToPOISsnMgmtReq', 'SASQ', 'SMIQ'],
    [protocol.buildLogoutRequest(DefaultConfig), 'SaleToPOISsnMgmtReq', 'SASQ', 'SMOQ'],
    [protocol.buildDiagnosisRequest(DefaultConfig), 'SaleToPOISsnMgmtReq', 'SASQ', 'SMDQ'],
  ];

  for (const [request, rootKey, headerFunction, serviceContent] of cases) {
    assert.equal(Object.keys(request.json)[0], rootKey);
    assert.equal(request.json[rootKey].Hdr.MsgFctn, headerFunction);
    if (serviceContent) {
      const content = request.json[rootKey].SvcReq?.SvcCntt || request.json[rootKey].SsnMgmtReq?.SvcCntt;
      assert.equal(content, serviceContent);
    }
    assert.deepEqual(validator.validate(request.msgFunction, request.json).errors, []);
  }
});

test('validator rejects legacy financial and session wrapper header codes', () => {
  const validator = new MessageValidator();
  const payment = protocol.buildPaymentRequest(DefaultConfig, { amount: '12.34' });
  payment.json.SaleToPOISvcReq.Hdr.MsgFctn = 'FSPQ';
  assert.match(validator.validate(payment.msgFunction, payment.json).errors.join('\n'), /expected SFSQ/);

  const login = protocol.buildLoginRequest(DefaultConfig);
  login.json.SaleToPOISsnMgmtReq.Hdr.MsgFctn = 'SARQ';
  assert.match(validator.validate(login.msgFunction, login.json).errors.join('\n'), /expected SASQ/);
});
