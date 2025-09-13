"use strict";

/**
 * Extract bridge lines using regex; safe for any runtime.
 * @param {string} html
 * @returns {Set<string>}
 */
function extractBridgeLinesRegex(html) {
  const set = new Set();
  const text = String(html || "");
  const obfs4 = /obfs4 \S+:\d+ [A-F0-9]{40} cert=\S+ iat-mode=\d+/g;
  const wt = /webtunnel \S+:\d+ [A-F0-9]{40} url=\S+ ver=\S+/g;
  let m;
  while ((m = obfs4.exec(text)) !== null) set.add(m[0]);
  while ((m = wt.exec(text)) !== null) set.add(m[0]);
  return set;
}

module.exports = { extractBridgeLinesRegex };

