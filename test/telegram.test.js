"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegram } = require("../src/core/telegram");

test("telegram chunking 4096", async () => {
  const calls = [];
  const fakeFetch = async (_url, init) => {
    calls.push(JSON.parse(init.body).text.length);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const tg = createTelegram({ token: "t", chatId: 1, fetchImpl: fakeFetch });
  const msg = "x".repeat(5000);
  await tg.sendMessage(msg);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 4096);
  assert.equal(calls[1], 904);
});

