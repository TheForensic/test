"use strict";

/**
 * Build per-type sets from persisted data.
 * @param {Record<string,{bridges:any[]}|undefined>} perTypeDocs
 * @returns {Record<string, Set<string>>}
 */
function toSets(perTypeDocs) {
  /** @type {Record<string, Set<string>>} */
  const map = {};
  for (const [type, doc] of Object.entries(perTypeDocs)) {
    const set = new Set();
    const arr = Array.isArray(doc?.bridges) ? doc.bridges : [];
    for (const it of arr) if (it && typeof it.bridge === "string") set.add(it.bridge.trim());
    map[type] = set;
  }
  return map;
}

/**
 * De-duplicate within each type using existing sets.
 * @param {Record<string, Set<string>>} existingSets
 * @param {Array<{type:string, data:any, raw:string}>} items
 */
function dedupeWithinType(existingSets, items) {
  /** @type {Record<string,string[]>} */
  const newByType = {};
  /** @type {Record<string,string[]>} */
  const dupByType = {};

  for (const it of items) {
    const t = it.type;
    const line = it.raw.trim();
    if (!existingSets[t]) existingSets[t] = new Set();
    if (existingSets[t].has(line)) {
      if (!dupByType[t]) dupByType[t] = [];
      dupByType[t].push(line);
      continue;
    }
    if (!newByType[t]) newByType[t] = [];
    newByType[t].push(line);
    existingSets[t].add(line);
  }
  return { newByType, dupByType };
}

module.exports = { toSets, dedupeWithinType };

