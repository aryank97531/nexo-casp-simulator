const net = require('node:net');
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { PhysicalTerminalBridge } = require('../src/physical-terminal-bridge');

test('physical terminal bridge accepts terminal connection, sends XML, and emits wire messages', async () => {
  const bridge = new PhysicalTerminalBridge({ host: '127.0.0.1', port: 0 });
  bridge.start();
  await once(bridge, 'status');

  const client = net.createConnection({ host: '127.0.0.1', port: bridge.getStatus().port });
  await once(client, 'connect');
  await waitFor(() => bridge.isConnected());

  const outbound = '<SaleToPOISsnMgmtReq><Hdr><MsgFctn>SASQ</MsgFctn></Hdr><SsnMgmtReq><SvcCntt>SMIQ</SvcCntt></SsnMgmtReq></SaleToPOISsnMgmtReq>';
  const inbound = '<SaleToPOISsnMgmtRspn><Hdr><MsgFctn>SASP</MsgFctn><PrtcolVrsn>8.0</PrtcolVrsn><XchgId>A1</XchgId><CreDtTm>2026-05-26T00:00:00.000Z</CreDtTm><InitgPty><Id>POI</Id></InitgPty></Hdr><SsnMgmtRspn><SvcCntt>SMIP</SvcCntt><Rspn><Rspn>SUCC</Rspn></Rspn></SsnMgmtRspn></SaleToPOISsnMgmtRspn>';

  const dataPromise = once(client, 'data');
  bridge.send(outbound);
  const [data] = await dataPromise;
  assert.equal(data.toString(), outbound);

  const messagePromise = once(bridge, 'wireMessage');
  client.write(inbound.slice(0, 60));
  client.write(inbound.slice(60));
  const [message] = await messagePromise;
  assert.equal(message.xml, inbound);
  assert.equal(message.msgFunction, 'SMIP');
  assert.equal(message.exchangeId, 'A1');

  client.destroy();
  bridge.stop();
});

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
