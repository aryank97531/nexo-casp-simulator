/**
 * Helpers for raw nexo XML wire messages.
 */
const { XMLParser } = require('fast-xml-parser');
const { MessageFunction } = require('./nexo/constants');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

function parseXml(xml) {
  const parsed = xmlParser.parse(xml);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Empty or invalid XML message');
  }
  return parsed;
}

function getRootKey(parsed) {
  return Object.keys(parsed || {})[0] || null;
}

function detectMessageFunction(parsed, rootKey = getRootKey(parsed)) {
  const root = parsed?.[rootKey];
  if (!root) return null;

  const containers = ['SvcReq', 'SvcRspn', 'SsnMgmtReq', 'SsnMgmtRspn', 'DvcReq', 'DvcRspn'];
  for (const container of containers) {
    if (root[container]?.SvcCntt) return root[container].SvcCntt;
  }

  const hdrFunction = root.Hdr?.MsgFctn;
  if (hdrFunction === MessageFunction.SFSQ) {
    return root.SvcReq?.SvcCntt || null;
  }
  if (hdrFunction === MessageFunction.SFSP) {
    return root.SvcRspn?.SvcCntt || null;
  }
  if (hdrFunction === MessageFunction.SASQ) {
    return root.SsnMgmtReq?.SvcCntt || null;
  }
  if (hdrFunction === MessageFunction.SASP) {
    return root.SsnMgmtRspn?.SvcCntt || null;
  }
  if (hdrFunction === MessageFunction.SARQ) {
    return root.RptReq?.SvcCntt || root.SsnMgmtReq?.SvcCntt || null;
  }

  const rootMap = {
    SaleToPOIRcncltnReq: MessageFunction.FSCQ,
    SaleToPOIRcncltnRspn: MessageFunction.FSCP,
    SaleToPOIAbrt: MessageFunction.SSAB,
    SaleToPOIMsgStsReq: MessageFunction.SSSQ,
    SaleToPOIMsgStsRspn: MessageFunction.SSSP,
    SaleToPOIMsgRjctn: MessageFunction.SSRR,
  };

  return rootMap[rootKey] || hdrFunction || null;
}

function extractExchangeId(parsed, rootKey = getRootKey(parsed)) {
  return parsed?.[rootKey]?.Hdr?.XchgId || null;
}

function extractXmlDocuments(buffer) {
  const documents = [];
  let rest = String(buffer || '');

  while (rest.length > 0) {
    const start = rest.search(/<SaleToPOI[A-Za-z0-9]+(?=[\s>])/);
    if (start < 0) {
      return { documents, rest: rest.slice(-4096) };
    }
    if (start > 0) rest = rest.slice(start);

    const startTag = rest.match(/^<([A-Za-z0-9:]+)(?=[\s>])/);
    if (!startTag) return { documents, rest };

    const closeTag = `</${startTag[1]}>`;
    const close = rest.indexOf(closeTag, startTag[0].length);
    if (close < 0) return { documents, rest };

    const end = close + closeTag.length;
    documents.push(rest.slice(0, end).trim());
    rest = rest.slice(end);
  }

  return { documents, rest };
}

module.exports = {
  parseXml,
  getRootKey,
  detectMessageFunction,
  extractExchangeId,
  extractXmlDocuments,
};
