"use strict";

/**
 * Telegram helper using fetch; chunks at 4096 chars.
 * @param {object} opts
 * @param {string} opts.token
 * @param {string|number} opts.chatId
 * @param {(input:RequestInfo, init?:RequestInit)=>Promise<Response>} opts.fetchImpl
 */
function createTelegram({ token, chatId, fetchImpl }) {
  const chat = String(chatId);
  async function sendMessage(html) {
    const chunkSize = 4096;
    for (let i = 0; i < html.length; i += chunkSize) {
      const part = html.substring(i, i + chunkSize);
      // eslint-disable-next-line no-await-in-loop
      await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: part, parse_mode: "HTML" }),
      });
    }
  }

  async function sendGrouped(title, grouped) {
    if (!grouped || Object.keys(grouped).length === 0) return;
    let message = `<b>${title}:</b>\n\n`;
    for (const [type, lines] of Object.entries(grouped)) {
      if (Array.isArray(lines) && lines.length > 0) {
        message += `<b>${type.replace("_", " ").toUpperCase()}:</b>\n`;
        for (const line of lines) message += `<code>${line}</code>\n\n`;
      }
    }
    await sendMessage(message);
  }

  return { sendMessage, sendGrouped };
}

module.exports = { createTelegram };

