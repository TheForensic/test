"use strict";

const http = require("http");
const url = require("url");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const path = require("path");
const cron = require("node-cron");
const crypto = require("crypto");
const fs = require("fs");
const parser = require("cron-parser");
const { createPanelRouter } = require("./panel/server-router");
const { runOnce } = require("./core");
const pkg = require("../package.json");
const { NodeFileStore } = require("./adapters/node-file-store");
const { NodeTelegramNotifier } = require("./adapters/node-telegram");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "";
const DISABLE_INTERNAL_CRON = String(process.env.DISABLE_INTERNAL_CRON || "").toLowerCase() === "true";
const INTERVAL_HOURS = Number(process.env.INTERVAL_HOURS || 12);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

const CONFIG_DIR = "config";
const bridgeFiles = {
  obfs4_ipv4: path.join(CONFIG_DIR, "obfs4_ipv4.json"),
  obfs4_ipv6: path.join(CONFIG_DIR, "obfs4_ipv6.json"),
  webtunnel_ipv4: path.join(CONFIG_DIR, "webtunnel_ipv4.json"),
  webtunnel_ipv6: path.join(CONFIG_DIR, "webtunnel_ipv6.json"),
};

const urlsMap = {
  obfs4_ipv4: "https://bridges.torproject.org/bridges?transport=obfs4",
  obfs4_ipv6: "https://bridges.torproject.org/bridges?transport=obfs4&ipv6=yes",
  webtunnel_ipv4: "https://bridges.torproject.org/bridges?transport=webtunnel",
  webtunnel_ipv6:
    "https://bridges.torproject.org/bridges?transport=webtunnel&ipv6=yes",
};

/** @type {import('./core').HttpFetch} */
async function httpFetch(u, headers) {
  try {
    const res = await fetch(u, { headers });
    const text = await res.text();
    return { ok: res.ok, statusText: res.statusText, text };
  } catch (e) {
    return { ok: false, statusText: String(e) };
  }
}

async function fetchHtml(u) {
  try {
    const res = await fetch(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Referer: "https://bridges.torproject.org/",
      },
    });
    return await res.text();
  } catch {
    return null;
  }
}

const store = new NodeFileStore(CONFIG_DIR, bridgeFiles);
const notifier = new NodeTelegramNotifier(BOT_TOKEN, CHAT_ID);

let running = false;
let lastRun = null;
let lastReport = null;
let cronTask = null;
let nextRun = null;

// ring buffer logs
const MAX_LOGS = 500;
const logs = [];
function logLine(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  logs.push(line);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(...args);
}

async function triggerRun() {
  if (running) return { status: "busy" };
  running = true;
  try {
    const report = await runOnce({ urls: urlsMap, fetchHtml, store, telegram: notifier });
    lastRun = new Date().toISOString();
    lastReport = report;
    return { status: "ok", lastRun, report };
  } catch (e) {
    lastRun = new Date().toISOString();
    return { status: "error", lastRun, error: String(e) };
  } finally {
    running = false;
  }
}

function computeNext(schedule) {
  try {
    const it = parser.parseExpression(schedule, { currentDate: new Date() });
    return it.next().toDate().toISOString();
  } catch { return null; }
}

function reloadSchedulerInitial() {
  if (DISABLE_INTERNAL_CRON) {
    logLine("Internal cron disabled via DISABLE_INTERNAL_CRON=true");
    return;
  }
  let schedule = CRON_SCHEDULE.trim();
  if (!schedule) {
    const hours = Number.isFinite(INTERVAL_HOURS) && INTERVAL_HOURS > 0 ? Math.floor(INTERVAL_HOURS) : 12;
    schedule = `0 */${hours} * * *`;
  }
  try {
    cronTask = cron.schedule(schedule, async () => {
      const r = await triggerRun();
      if (r.status === "busy") logLine("Scheduled run skipped (busy)");
      nextRun = computeNext(schedule);
    }, { scheduled: true });
    nextRun = computeNext(schedule);
    logLine(`Internal cron enabled: ${schedule}`);
  } catch (e) {
    logLine(`Failed to start internal cron with schedule '${schedule}': ${e}`);
  }
}

function readEnv() {
  return {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
    PORT: String(PORT),
    BIND_HOST: BIND_HOST,
    CRON_SCHEDULE: process.env.CRON_SCHEDULE || CRON_SCHEDULE,
    INTERVAL_HOURS: String(process.env.INTERVAL_HOURS || INTERVAL_HOURS),
    DISABLE_INTERNAL_CRON: String(process.env.DISABLE_INTERNAL_CRON || DISABLE_INTERNAL_CRON),
  };
}

async function updateEnv(changes) {
  const envPath = path.join(process.cwd(), ".env");
  let current = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const l of lines) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) current[m[1]] = m[2];
    }
  }
  for (const [k, v] of Object.entries(changes)) current[k] = String(v == null ? "" : v);
  const ordered = ["TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","PORT","BIND_HOST","CRON_SCHEDULE","INTERVAL_HOURS","DISABLE_INTERNAL_CRON","ADMIN_USER","ADMIN_PASS","JWT_SECRET"];
  const setKeys = new Set(Object.keys(current).concat(ordered));
  const body = Array.from(setKeys).map(k => `${k}=${current[k] || ""}`).join("\n");
  fs.writeFileSync(envPath, body);
  Object.assign(process.env, changes);
}

function reloadScheduler({ cron: cronStr, intervalHours, disable } = {}) {
  if (cronTask) try { cronTask.stop(); } catch {}
  const disabled = typeof disable === 'boolean' ? disable : (String(process.env.DISABLE_INTERNAL_CRON || "").toLowerCase() === "true");
  if (disabled) { nextRun = null; logLine("Internal cron disabled"); return; }
  let schedule = (cronStr && cronStr.trim()) || (Number(intervalHours||process.env.INTERVAL_HOURS||12)>0 ? `0 */${Math.floor(Number(intervalHours||process.env.INTERVAL_HOURS||12))} * * *` : `0 */12 * * *`);
  try {
    cronTask = cron.schedule(schedule, async () => {
      const r = await triggerRun();
      if (r.status === "busy") logLine("Scheduled run skipped (busy)");
      nextRun = computeNext(schedule);
    }, { scheduled: true });
    nextRun = computeNext(schedule);
    logLine(`Internal cron enabled: ${schedule}`);
  } catch (e) {
    logLine(`Failed to start internal cron with schedule '${schedule}': ${e}`);
  }
}

const panel = createPanelRouter({
  triggerRun,
  getStatus: () => ({ running, lastRun, nextRun, version: pkg.version }),
  updateEnv,
  readEnv,
  getLogs: () => logs.slice(-MAX_LOGS),
  getLogsBuffer: () => Buffer.from(logs.join("\n")),
  reloadScheduler,
  jwtSecret: JWT_SECRET,
});

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);
  if ((parsed.pathname || "").startsWith("/panel") || parsed.pathname === "/auth/login" || parsed.pathname === "/auth/logout" || parsed.pathname === "/config" || parsed.pathname === "/secrets" || parsed.pathname === "/logs" || parsed.pathname === "/logs/download" || parsed.pathname === "/health" || parsed.pathname === "/run") {
    return panel.handle(req, res);
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, BIND_HOST, () => {
  // Compute a nicer advertised IP for banner when binding 0.0.0.0
  let advHost = BIND_HOST;
  try {
    if (BIND_HOST === '0.0.0.0') {
      const os = require('os');
      const ifs = os.networkInterfaces();
      for (const key of Object.keys(ifs)) {
        for (const inf of ifs[key] || []) {
          if (inf.family === 'IPv4' && !inf.internal) { advHost = inf.address; break; }
        }
        if (advHost !== '0.0.0.0') break;
      }
    }
  } catch {}
  console.log(`HTTP server listening on ${BIND_HOST}:${PORT}`);
  console.log(`Server mode: Panel at http://${advHost}:${PORT}/panel`);
  reloadSchedulerInitial();
});
