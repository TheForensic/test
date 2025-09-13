"use strict";

const { parseAndClassifyBridge } = require("./core/parse");
const { extractBridgeLinesRegex } = require("./core/fetchBridges");
const { toSets, dedupeWithinType } = require("./core/dedupe");

/**
 * @typedef {"obfs4_ipv4"|"obfs4_ipv6"|"webtunnel_ipv4"|"webtunnel_ipv6"} BridgeType
 */

/**
 * @typedef {{
 *  readAll: () => Promise<Record<string,{bridges:any[]}>>, // by type
 *  append: (type: BridgeType, data: any) => Promise<void>
 * }} Store
 */

/**
 * @typedef {{ sendMessage: (html:string)=>Promise<void>, sendGrouped: (title:string, grouped:Record<string,string[]>)=>Promise<void> }} Telegram
 */

/**
 * @typedef {{ urls: Record<BridgeType,string>, fetchHtml: (url:string)=>Promise<string|null>, store: Store, telegram: Telegram, delayMs?: (n:number)=>Promise<void> }} RunDeps
 */

/**
 * Orchestrator: fetch, parse, classify, dedupe per type, persist, notify.
 * Keeps message content and 1s delay exactly as before.
 * @param {RunDeps} deps
 */
async function runOnce({ urls, fetchHtml, store, telegram, delayMs = (n)=>new Promise(r=>setTimeout(r,n)) }) {
  const perTypeDocs = await store.readAll();
  const existingSets = toSets(perTypeDocs);

  /** @type {string[]} */
  const lines = [];
  for (const url of Object.values(urls)) {
    try {
      const html = await fetchHtml(url);
      if (!html) continue;
      const set = extractBridgeLinesRegex(html);
      for (const l of set) lines.push(l);
    } catch {}
  }

  /** @type {Record<string, string[]>} */
  const newBridges = {};
  /** @type {Record<string, string[]>} */
  const duplicateBridges = {};
  /** @type {string[]} */
  const malformedBridges = [];

  if (lines.length === 0) {
    await telegram.sendMessage("❌ <b>Failed to fetch any bridges.</b>\nPlease check logs or try again later.");
    return { newBridges, duplicateBridges, malformedBridges };
  }

  /** @type {Array<{type:string,data:any,raw:string}>} */
  const parsedItems = [];
  for (const l of lines) {
    const p = parseAndClassifyBridge(l);
    if (!p) malformedBridges.push(l);
    else parsedItems.push({ type: p.type, data: p.data, raw: l });
  }

  const { newByType, dupByType } = dedupeWithinType(existingSets, parsedItems);

  for (const [t, arr] of Object.entries(newByType)) {
    for (const raw of arr) {
      const p = parseAndClassifyBridge(raw);
      if (p) await store.append(p.type, p.data);
    }
    newBridges[t] = arr;
  }
  for (const [t, arr] of Object.entries(dupByType)) duplicateBridges[t] = arr;

  if (Object.keys(newBridges).length > 0) {
    await telegram.sendGrouped("🚀 Latest Tor Bridges", newBridges);
    await delayMs(1000);
  }
  await telegram.sendGrouped("Duplicate Bridges Found", duplicateBridges);

  if (malformedBridges.length > 0) {
    let msg = "<b>Malformed Bridges Found:</b>\n\n";
    for (const b of malformedBridges) msg += `<code>${b}</code>\n\n`;
    await telegram.sendMessage(msg);
  }

  return { newBridges, duplicateBridges, malformedBridges };
}

module.exports = { runOnce };
