"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAndClassifyBridge } = require("../src/core/parse");

test("parse obfs4 ipv4", () => {
  const line = "obfs4 1.2.3.4:443 ABCDEF0123456789ABCDEF0123456789ABCDEF01 cert=abc iat-mode=0";
  const p = parseAndClassifyBridge(line);
  assert.ok(p);
  assert.equal(p.type, "obfs4_ipv4");
});

test("parse webtunnel ipv6", () => {
  const line = "webtunnel [2001:db8::1]:443 ABCDEF0123456789ABCDEF0123456789ABCDEF01 url=https://x.test ver=1";
  const p = parseAndClassifyBridge(line);
  assert.ok(p);
  assert.equal(p.type, "webtunnel_ipv6");
});

