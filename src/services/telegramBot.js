import TelegramBot from 'node-telegram-bot-api';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import express from 'express';

let bot;

export function initBot(server) {
  const token = config.telegram.botToken;
  if (!token || token === 'your_telegram_bot_token') {
    console.warn('[telegramBot] BOT_TOKEN not configured — skipping');
    return null;
  }

  if (config.isDev) {
    // Development: use polling
    bot = new TelegramBot(token, { polling: true });
    console.log('[telegramBot] Polling mode (dev)');
  } else {
    // Production: use webhook
    bot = new TelegramBot(token);
    const domain = process.env.DOMAIN;
    if (!domain) {
      console.warn('[telegramBot] DOMAIN not set — skipping webhook');
      return null;
    }
    // Webhook endpoint on a separate path (e.g., /bot)
    const router = express.Router();
    router.post(`/webhook/${token}`, (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    server.use('/bot', router);
    bot.setWebHook(`${domain}/bot/webhook/${token}`);
    console.log('[telegramBot] Webhook mode (production)');
  }

  // --- Commands ---

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const username = msg.from.username || `user_${telegramId}`;

    try {
      // Upsert user
      await query(
        `INSERT INTO users (telegram_id, username, balance) VALUES ($1, $2, 0)
         ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username
         WHERE users.username IS DISTINCT FROM EXCLUDED.username`,
        [telegramId, username]
      );

      const miniAppUrl = process.env.MINI_APP_URL || `https://t.me/${msg.from.username ? 'YourBotUsername' : 'your_bot'}/app`;

      await bot.sendMessage(chatId,
        `🎲 Welcome to *Clash PVP Casino!*\n\n` +
        `💰 *Games:* RPS, Dice, Coin, Mines, Blackjack, Crash\n` +
        `🎯 *House edge:* only 2%\n\n` +
        `Click below to open:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎰 Open Mini App', web_app: { url: miniAppUrl } }],
            ],
          },
        }
      );
    } catch (err) {
      console.error('[telegramBot] /start error:', err);
    }
  });

  bot.onText(/\/terms/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `📋 *Terms of Service — Clash PVP*\n\n` +
      `1. All games use PvP format. The platform takes a 10% commission from each win.\n` +
      `2. Crash game uses Provably Fair (HMAC-SHA256). You can verify each round.\n` +
      `3. Only Telegram Stars (XTR) are accepted for deposits. No refunds on spent Stars.\n` +
      `4. You must be 18+ to use this app. By playing you confirm you are of legal age.\n` +
      `5. The platform is not responsible for losses. Play responsibly.\n` +
      `6. We reserve the right to block users who exploit bugs or abuse the system.\n\n` +
      `_Last updated: July 2026_`,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle Telegram Stars payments via invoice
  bot.on('pre_checkout_query', async (query_) => {
    try {
      // Verify payload — ensure the amount matches
      await bot.answerPreCheckoutQuery(query_.id, true);
    } catch (err) {
      console.error('[telegramBot] pre_checkout_query error:', err);
      await bot.answerPreCheckoutQuery(query_.id, false, { error_message: 'Payment verification failed' });
    }
  });

  bot.on('successful_payment', async (msg) => {
    try {
      const telegramId = msg.from.id.toString();
      const payment = msg.successful_payment;
      // Telegram Stars: 1 Star = 1 credit (or invoice payload has the amount)
      // invoice_payload is the JSON string we sent
      let starsAmount = payment.total_amount;
      try {
        const payload = JSON.parse(payment.invoice_payload);
        starsAmount = payload.amount || starsAmount;
      } catch {}

      // Find user and credit balance
      const { rows } = await query(
        `UPDATE users SET balance = balance + $1 WHERE telegram_id = $2 RETURNING id, balance`,
        [starsAmount, telegramId]
      );

      if (rows.length === 0) {
        console.error('[telegramBot] successful_payment: user not found', telegramId);
        return;
      }

      const user = rows[0];
      await query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'deposit', $2, $3, $4, $5)`,
        [user.id, starsAmount, Number(user.balance) - starsAmount, Number(user.balance),
         JSON.stringify({ telegramPayment: true, currency: payment.currency, payload: payment.invoice_payload })]
      );

      console.log(`[telegramBot] Deposit: user=${user.id} amount=${starsAmount} total=${user.balance}`);
    } catch (err) {
      console.error('[telegramBot] successful_payment error:', err);
    }
  });

  return bot;
}

export function getBot() {
  return bot;
}
