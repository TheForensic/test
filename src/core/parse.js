"use strict";

/**
 * @param {string} address
 */
function isIPv6(address) {
  return address.includes(":");
}

/**
 * @param {string} bridgeLine
 * @returns {{ type: 'obfs4_ipv4'|'obfs4_ipv6'|'webtunnel_ipv4'|'webtunnel_ipv6', fingerprint: string, data: any }|null}
 */
function parseAndClassifyBridge(bridgeLine) {
  const line = bridgeLine.trim();
  const parts = line.split(" ");
  const transport = parts[0];
  if (transport !== "obfs4" && transport !== "webtunnel") return null;

  if (transport === "obfs4") {
    const m = line.match(
      /(obfs4)\s+((?:\[[a-fA-F0-9:]+\]|\d{1,3}(?:\.\d{1,3}){3}))(?::(\d+))\s+([A-F0-9]{40})\s+cert=([^\s]+)\s+iat-mode=([0-9]+)/
    );
    if (!m) return null;
    const [, , ip, port, fingerprint, cert, iatMode] = m;
    const ipClean = ip.replace(/[\[\]]/g, "");
    const type = isIPv6(ipClean) ? "obfs4_ipv6" : "obfs4_ipv4";
    return {
      type,
      fingerprint,
      data: {
        bridge: line,
        ip: ipClean,
        port,
        fingerprint,
        cert,
        "iat-mode": iatMode,
        addedAt: new Date().toISOString(),
      },
    };
  }

  const m = line.match(
    /(webtunnel)\s+((?:\[[a-fA-F0-9:]+\]|\d{1,3}(?:\.\d{1,3}){3}))(?::(\d+))\s+([A-F0-9]{40})\s+url=([^\s]+)\s+ver=([^\s]+)/
  );
  if (!m) return null;
  const [, , ip, port, fingerprint, url, ver] = m;
  const ipClean = ip.replace(/[\[\]]/g, "");
  const type = isIPv6(ipClean) ? "webtunnel_ipv6" : "webtunnel_ipv4";
  return {
    type,
    fingerprint,
    data: {
      bridge: line,
      ip: ipClean,
      port,
      fingerprint,
      url,
      ver,
      addedAt: new Date().toISOString(),
    },
  };
}

module.exports = { isIPv6, parseAndClassifyBridge };

