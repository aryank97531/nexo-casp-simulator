const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractXmlDocuments,
  parseXml,
  getRootKey,
  detectMessageFunction,
  extractExchangeId,
} = require('../src/xml-wire');

test('extractXmlDocuments handles fragmented and adjacent raw XML documents', () => {
  const first = '<SaleToPOISsnMgmtRspn><Hdr><MsgFctn>SASP</MsgFctn><XchgId>A1</XchgId></Hdr><SsnMgmtRspn><SvcCntt>SMIP</SvcCntt></SsnMgmtRspn></SaleToPOISsnMgmtRspn>';
  const second = '<SaleToPOISvcRspn><Hdr><MsgFctn>SFSP</MsgFctn><XchgId>B2</XchgId></Hdr><SvcRspn><SvcCntt>FSPP</SvcCntt></SvcRspn></SaleToPOISvcRspn>';

  let out = extractXmlDocuments(`noise${first}${second.slice(0, 50)}`);
  assert.deepEqual(out.documents, [first]);
  assert.equal(out.rest, second.slice(0, 50));

  out = extractXmlDocuments(out.rest + second.slice(50));
  assert.deepEqual(out.documents, [second]);
  assert.equal(out.rest, '');
});

test('wire helpers parse response service content and exchange id', () => {
  const xml = '<SaleToPOISvcRspn><Hdr><MsgFctn>SFSP</MsgFctn><PrtcolVrsn>8.0</PrtcolVrsn><XchgId>B2</XchgId><CreDtTm>2026-05-26T00:00:00.000Z</CreDtTm><InitgPty><Id>POI</Id></InitgPty></Hdr><SvcRspn><SvcCntt>FSPP</SvcCntt></SvcRspn></SaleToPOISvcRspn>';
  const parsed = parseXml(xml);
  const rootKey = getRootKey(parsed);
  assert.equal(rootKey, 'SaleToPOISvcRspn');
  assert.equal(detectMessageFunction(parsed, rootKey), 'FSPP');
  assert.equal(extractExchangeId(parsed, rootKey), 'B2');
});
