"use strict";

const { Telegraf } = require("telegraf");

/**
 * Telegram notifier using Telegraf for Node.js
 */
class NodeTelegramNotifier {
  /**
   * @param {string} botToken
   * @param {string|number} chatId
   */
  constructor(botToken, chatId) {
    this.chatId = String(chatId);
    this.bot = new Telegraf(botToken);
  }

  async sendMessage(html) {
    const chunkSize = 4096;
    for (let i = 0; i < html.length; i += chunkSize) {
      const part = html.substring(i, i + chunkSize);
      // mirrors existing HTML parse mode
      // eslint-disable-next-line no-await-in-loop
      await this.bot.telegram.sendMessage(this.chatId, part, {
        parse_mode: "HTML",
      });
    }
  }

  /**
   * @param {string} title
   * @param {Record<string,string[]>} grouped
   */
  async sendGrouped(title, grouped) {
    if (!grouped || Object.keys(grouped).length === 0) return;
    let message = `<b>${title}:</b>\n\n`;
    for (const [type, lines] of Object.entries(grouped)) {
      if (Array.isArray(lines) && lines.length > 0) {
        message += `<b>${type.replace("_", " ").toUpperCase()}:</b>\n`;
        for (const line of lines) message += `<code>${line}</code>\n\n`;
      }
    }
    await this.sendMessage(message);
  }
}

module.exports = { NodeTelegramNotifier };
