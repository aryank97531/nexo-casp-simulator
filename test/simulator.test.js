const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../src/nexo/protocol');
const { POISimulator } = require('../src/nexo/simulator');
const { DefaultConfig } = require('../src/nexo/constants');

test('simulated financial requests require login', async () => {
  const simulator = new POISimulator(DefaultConfig);
  const payment = protocol.buildPaymentRequest(DefaultConfig, { amount: '12.34' });
  const result = await simulator.processRequest(payment.msgFunction, payment.json, payment.exchangeId);

  assert.equal(result.response.status, 'error');
  assert.equal(result.response.displayText, 'LOGIN REQUIRED');
  assert.equal(result.response.json.SaleToPOISvcRspn.Hdr.MsgFctn, 'SFSP');
  assert.equal(result.response.json.SaleToPOISvcRspn.SvcRspn.Rspn.RspnRsn, 'LOGN');
});

test('simulated login enables a payment response with compliant response header', async () => {
  const simulator = new POISimulator(DefaultConfig);
  const login = protocol.buildLoginRequest(DefaultConfig);
  await simulator.processRequest(login.msgFunction, login.json, login.exchangeId);

  const payment = protocol.buildPaymentRequest(DefaultConfig, { amount: '12.34' });
  const result = await simulator.processRequest(payment.msgFunction, payment.json, payment.exchangeId);

  assert.equal(result.response.status, 'success');
  assert.equal(result.response.msgFunction, 'FSPP');
  assert.equal(result.response.json.SaleToPOISvcRspn.Hdr.MsgFctn, 'SFSP');
  assert.equal(result.response.json.SaleToPOISvcRspn.SvcRspn.SvcCntt, 'FSPP');
});
