"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const parser = require("cron-parser");

// Simple in-memory login throttle
const loginState = {
  attempts: 0,
  lockedUntil: 0,
};

function now() {
  return Date.now();
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJWT(payload, secret, expSeconds) {
  const header = { alg: "HS256", typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const payloadWithExp = { ...payload, iat, exp: iat + expSeconds };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payloadWithExp));
  const toSign = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(toSign).digest("base64");
  const encSig = sig.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${toSign}.${encSig}`;
}

function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const toSign = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", secret).update(toSign).digest("base64");
  const encSig = sig.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (encSig !== s) return null;
  const payload = JSON.parse(Buffer.from(p, "base64").toString());
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers["cookie"] || "";
  const out = {};
  header.split(";").forEach((v) => {
    const idx = v.indexOf("=");
    if (idx > -1) {
      const k = v.slice(0, idx).trim();
      const val = v.slice(idx + 1).trim();
      out[k] = decodeURIComponent(val);
    }
  });
  return out;
}

function serveFile(res, filePath, contentType = "text/html") {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

function computeNextRun(cronExpression, intervalHours) {
  try {
    const expr = cronExpression && cronExpression.trim() ? cronExpression : (intervalHours && Number(intervalHours) > 0 ? `0 */${Math.floor(Number(intervalHours))} * * *` : `0 */12 * * *`);
    const it = parser.parseExpression(expr, { currentDate: new Date() });
    return it.next().toDate().toISOString();
  } catch {
    return null;
  }
}

/**
 * Panel router factory
 * @param {object} deps
 * @param {() => Promise<any>} deps.triggerRun
 * @param {() => { running: boolean, lastRun: string|null, nextRun: string|null }} deps.getStatus
 * @param {(changes: Record<string,string>) => Promise<void>} deps.updateEnv
 * @param {() => Record<string,string>} deps.readEnv
 * @param {() => string[]} deps.getLogs
 * @param {() => Buffer} deps.getLogsBuffer
 * @param {(schedule?: { cron?: string, intervalHours?: number, disable?: boolean }) => void} deps.reloadScheduler
 * @param {string} deps.jwtSecret
 */
function createPanelRouter(deps) {
  const viewsDir = path.join(__dirname, "views");

  function authGuard(req, res) {
    if (req.url.startsWith("/panel/login")) return true;
    if (req.url === "/auth/login") return true;
    if (req.url === "/auth/logout") return true;
    if (req.url === "/health") return true;
    const cookies = parseCookies(req);
    const token = cookies["atb_session"] || "";
    const payload = verifyJWT(token, deps.jwtSecret);
    if (!payload) {
      res.writeHead(302, { Location: "/panel/login" });
      res.end();
      return false;
    }
    // CSRF for POSTs
    if (req.method === "POST") {
      const csrf = req.headers["x-csrf"] || "";
      if (!csrf || csrf !== payload.csrf) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "csrf_invalid" }));
        return false;
      }
    }
    req.user = payload;
    return true;
  }

  async function handle(req, res) {
    // Static assets for panel
    if (req.url.startsWith("/panel/")) {
      if (!authGuard(req, res)) return;
      const rel = req.url === "/panel/" ? "index.html" : req.url.replace("/panel/", "");
      const target = path.join(viewsDir, rel);
      const ext = path.extname(target);
      const type = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "text/html";
      return serveFile(res, target, type);
    }

    // CSRF token fetch (after login)
    if (req.url === "/panel/csrf" && req.method === "GET") {
      const cookies = parseCookies(req);
      const token = cookies["atb_session"] || "";
      const payload = verifyJWT(token, deps.jwtSecret);
      if (!payload) { res.writeHead(401).end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ csrf: payload.csrf }));
    }

    // Login page (no auth)
    if (req.url === "/panel/login") {
      const file = path.join(viewsDir, "login.html");
      return serveFile(res, file, "text/html");
    }

    if (req.url === "/auth/login" && req.method === "POST") {
      if (loginState.lockedUntil > now()) {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "locked" }));
      }
      const body = await readBody(req);
      const user = (process.env.ADMIN_USER || "admin").trim();
      const pass = (process.env.ADMIN_PASS || "").trim();
      if (!body.username || !body.password || body.username !== user || body.password !== pass) {
        loginState.attempts += 1;
        if (loginState.attempts >= 5) {
          loginState.lockedUntil = now() + 10 * 60 * 1000; // 10m
          loginState.attempts = 0;
        }
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false }));
      }
      loginState.attempts = 0;
      const csrf = crypto.randomBytes(16).toString("hex");
      const token = signJWT({ sub: user, csrf }, deps.jwtSecret, 60 * 60 * 12); // 12h
      res.writeHead(200, {
        "set-cookie": `atb_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 12}`,
        "content-type": "application/json",
      });
      return res.end(JSON.stringify({ ok: true, csrf }));
    }

    if (req.url === "/auth/logout" && req.method === "POST") {
      res.writeHead(200, {
        "set-cookie": `atb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
        "content-type": "application/json",
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (!authGuard(req, res)) return;

    if (req.url === "/config" && req.method === "GET") {
      const env = deps.readEnv();
      const redacted = { ...env, TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ? "***" : "", TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID ? "***" : "" };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, config: redacted }));
    }

    if (req.url === "/config" && req.method === "POST") {
      const body = await readBody(req);
      const changes = {};
      if (typeof body.CRON_SCHEDULE === "string") changes.CRON_SCHEDULE = body.CRON_SCHEDULE;
      if (typeof body.INTERVAL_HOURS !== "undefined") changes.INTERVAL_HOURS = String(body.INTERVAL_HOURS);
      if (typeof body.DISABLE_INTERNAL_CRON !== "undefined") changes.DISABLE_INTERNAL_CRON = String(body.DISABLE_INTERNAL_CRON);
      if (typeof body.BIND_HOST === "string") changes.BIND_HOST = body.BIND_HOST;
      await deps.updateEnv(changes);
      deps.reloadScheduler({ cron: changes.CRON_SCHEDULE, intervalHours: Number(changes.INTERVAL_HOURS), disable: String(changes.DISABLE_INTERNAL_CRON).toLowerCase() === "true" });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.url === "/secrets" && req.method === "POST") {
      const body = await readBody(req);
      const changes = {};
      if (typeof body.TELEGRAM_BOT_TOKEN === "string" && body.TELEGRAM_BOT_TOKEN) changes.TELEGRAM_BOT_TOKEN = body.TELEGRAM_BOT_TOKEN;
      if (typeof body.TELEGRAM_CHAT_ID === "string" && body.TELEGRAM_CHAT_ID) changes.TELEGRAM_CHAT_ID = body.TELEGRAM_CHAT_ID;
      await deps.updateEnv(changes);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.url === "/logs" && req.method === "GET") {
      const logs = deps.getLogs();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, logs }));
    }

    if (req.url === "/logs/download" && req.method === "GET") {
      const buf = deps.getLogsBuffer();
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": `attachment; filename=autobridgebot.log`,
      });
      return res.end(buf);
    }

    if (req.url === "/health" && req.method === "GET") {
      const status = deps.getStatus();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, ...status }));
    }

    if (req.url === "/run" && (req.method === "GET" || req.method === "POST")) {
      const r = await deps.triggerRun();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(r));
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  }

  return { handle, computeNextRun };
}

module.exports = { createPanelRouter };
