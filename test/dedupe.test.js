"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { dedupeWithinType } = require("../src/core/dedupe");

test("dedupe within type", () => {
  const existing = { obfs4_ipv4: new Set(["A"]) };
  const items = [
    { type: "obfs4_ipv4", data: {}, raw: "A" },
    { type: "obfs4_ipv4", data: {}, raw: "B" },
    { type: "webtunnel_ipv6", data: {}, raw: "X" },
    { type: "webtunnel_ipv6", data: {}, raw: "X" },
  ];
  const { newByType, dupByType } = dedupeWithinType(existing, items);
  assert.deepEqual(newByType.obfs4_ipv4, ["B"]);
  assert.deepEqual(dupByType.obfs4_ipv4, ["A"]);
  assert.deepEqual(newByType.webtunnel_ipv6, ["X"]);
  assert.deepEqual(dupByType.webtunnel_ipv6, ["X"]);
});

