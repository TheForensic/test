#!/usr/bin/env node
"use strict";

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const path = require("path");
const { runOnce } = require("../src/core");
const { NodeFileStore } = require("../src/adapters/node-file-store");
const { NodeTelegramNotifier } = require("../src/adapters/node-telegram");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const CONFIG_DIR = "config";
const bridgeFiles = {
  obfs4_ipv4: path.join(CONFIG_DIR, "obfs4_ipv4.json"),
  obfs4_ipv6: path.join(CONFIG_DIR, "obfs4_ipv6.json"),
  webtunnel_ipv4: path.join(CONFIG_DIR, "webtunnel_ipv4.json"),
  webtunnel_ipv6: path.join(CONFIG_DIR, "webtunnel_ipv6.json"),
};

const urls = {
  obfs4_ipv4: "https://bridges.torproject.org/bridges?transport=obfs4",
  obfs4_ipv6: "https://bridges.torproject.org/bridges?transport=obfs4&ipv6=yes",
  webtunnel_ipv4: "https://bridges.torproject.org/bridges?transport=webtunnel",
  webtunnel_ipv6:
    "https://bridges.torproject.org/bridges?transport=webtunnel&ipv6=yes",
};

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Referer: "https://bridges.torproject.org/",
      },
    });
    const text = await res.text();
    // Prefer cheerio extraction: if it yields results, return the original HTML as-is.
    const $ = cheerio.load(text);
    const count = $("pre.bridge-line").length;
    if (count > 0) return text;
    return text;
  } catch {
    return null;
  }
}

async function main() {
  console.log("CI/CLI mode: Panel disabled; running once.");
  const store = new NodeFileStore(CONFIG_DIR, bridgeFiles);
  const notifier = new NodeTelegramNotifier(BOT_TOKEN, CHAT_ID);
  const report = await runOnce({ urls, fetchHtml, store, telegram: notifier });
  // Print brief JSON summary for CI logs
  process.stdout.write(JSON.stringify({ ok: true, report }) + "\n");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
