import TelegramBot from 'node-telegram-bot-api';
import { query, getClient } from '../db/pool.js';
import { config } from '../config.js';
import express from 'express';

let bot;
let pollingRestartTimer;

const POLLING_CONFLICT_RETRY_MS = 10_000;

function isPollingConflict(err) {
  const status = err?.response?.status ?? err?.response?.statusCode;
  return status === 409 || /409 Conflict.*getUpdates/i.test(err?.message || '');
}

function restartPollingAfterConflict() {
  if (pollingRestartTimer || !bot) return;

  console.warn(`[telegramBot] polling conflict; retrying in ${POLLING_CONFLICT_RETRY_MS / 1000}s`);
  pollingRestartTimer = setTimeout(async () => {
    pollingRestartTimer = undefined;
    try {
      await bot.startPolling();
      console.log('[telegramBot] polling resumed');
    } catch (err) {
      console.error('[telegramBot] polling restart failed:', err.message);
      restartPollingAfterConflict();
    }
  }, POLLING_CONFLICT_RETRY_MS);
  pollingRestartTimer.unref?.();
}

export function initBot(server) {
  const token = config.telegram.botToken;
  if (!token || token === 'your_telegram_bot_token') {
    console.warn('[telegramBot] BOT_TOKEN not configured — skipping');
    return null;
  }

  // Starting after HTTP is listening makes startup and shutdown ordering explicit.
  bot = new TelegramBot(token, { polling: { autoStart: false } });
  console.log(`[telegramBot] Polling mode (${config.isDev ? 'dev' : 'production'})`);

  bot.on('polling_error', (err) => {
    if (!isPollingConflict(err)) {
      console.error('[telegramBot] polling error:', err.message);
      return;
    }

    void bot.stopPolling({ cancel: true }).finally(restartPollingAfterConflict);
  });
  bot.on('error', (err) => {
    console.error('[telegramBot] client error:', err.message);
  });

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

      const miniAppUrl = process.env.MINI_APP_URL || 'https://clashpvp.app';

      await bot.sendMessage(chatId,
        `🎲 Welcome to *Starqc!*\n\n` +
        `💰 *Games:* RPS, Dice, Coin, Mines, Blackjack, Crash, Roulette\n\n` +
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
      `📋 *Правила платформы — Starqc*\n\n` +
      `*1. Общие положения*\n` +
      `Сервис Starqc предоставляет развлекательные PvP-мини-игры, где участники могут соревноваться друг с другом, используя внутреннюю валюту Stars. Участие в играх является добровольным.\n` +
      `Платформа предназначена исключительно для развлечения. Используя её, вы соглашаетесь с настоящими правилами.\n` +
      `Администрация оставляет за собой право изменять правила без предварительного уведомления.\n` +
      `Минимальный возраст для использования платформы — 18 лет.\n\n` +
      `*2. Как работают игры*\n` +
      `*Камень-Ножницы-Бумага (RPS)*\n` +
      `PvP-дуэль: оба игрока выбирают ход (✊✋✌️). Победитель забирает ставку ×2. Ничья — возврат. Комиссия платформы: 10% с выигрыша.\n\n` +
      `*Кости (Dice)*\n` +
      `Каждый бросает кубик (1-6). У кого больше — победил. Совпадение — ничья. Комиссия: 10%.\n\n` +
      `*Монетка (Coin)*\n` +
      `Угадай Орла 🦅 или Решку 🪙. Угадал — забираешь ставку ×2 минус 10% комиссия.\n\n` +
      `*Мины (Mines)*\n` +
      `Одиночная игра на поле 5×5. Выберите от 1 до 24 мин, открывайте безопасные клетки и заберите выигрыш в любой момент. Наткнулись на мину — ставка сгорает. Комиссия: 10%.\n\n` +
      `*Блекджек (Blackjack)*\n` +
      `Собери 21 или ближе к 21, чем соперник. Hit — ещё карта, Stand — хватит. Перебор >21 — проигрыш. Комиссия: 10%.\n\n` +
      `*Crash*\n` +
      `Множитель растёт с 1.00×. Забери деньги до взрыва. Не успел — ставка сгорает. Provably Fair (HMAC-SHA256) — каждый раунд можно проверить. Комиссия встроена в алгоритм (10%).\n\n` +
      `*Рулетка*\n` +
      `Общий раунд: красное и чёрное x2, zero x14. До закрытия приёма ставку можно отменить. Результат Provably Fair и проверяется после раунда.\n\n` +
      `*3. Финансы и баланс*\n` +
      `Stars (Звёзды) списываются безвозвратно в момент ставки. Нажимая кнопку участия, вы соглашаетесь с тем, что потраченные средства списываются немедленно.\n` +
      `В случае проигрыша в любой из игр средства не возвращаются. Вы платите за участие и шанс выиграть, а не за гарантированный приз.\n` +
      `Вывод средств не предусмотрен. Stars приобретаются через Telegram и используются только внутри платформы.\n` +
      `Запрещено использовать баги и уязвимости для получения преимущества. О найденных ошибках необходимо сообщать администрации.\n\n` +
      `*4. Запрещённые действия*\n` +
      `• Использование любого стороннего ПО: скриптов автоматизации, прямой отправки запросов вне стандартного клиента Telegram, любого ПО, способного нарушить стабильную работу сервиса.\n` +
      `• Участие в собственных розыгрышах.\n` +
      `• Регистрация более одного аккаунта (мультиаккаунтинг).\n` +
      `• Сговор между игроками с целью манипуляции результатами.\n` +
      `• Оскорбления, угрозы и любые формы токсичного поведения.\n` +
      `• Попытки обмана других пользователей или администрации.\n` +
      `• Распространение ложной информации о платформе.\n\n` +
      `*5. Санкции*\n` +
      `За нарушение правил администрация может вынести предупреждение, временную или постоянную блокировку аккаунта.\n` +
      `При блокировке за мошенничество баланс аннулируется без возможности восстановления.\n` +
      `Решения администрации являются окончательными.\n\n` +
      `*6. Ответственность*\n` +
      `Платформа не несёт ответственности за технические сбои, вызванные внешними факторами.\n` +
      `Пользователь самостоятельно оценивает риски, связанные с участием в играх.\n` +
      `Администрация не несёт ответственности за действия третьих лиц.\n` +
      `Незнание правил не освобождает от ответственности.\n\n` +
      `Используя платформу Starqc, вы подтверждаете, что ознакомились с данными правилами и принимаете их в полном объёме.\n\n` +
      `📞 *Поддержка:* @ama833`,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle Telegram Stars payments via invoice
  bot.on('pre_checkout_query', async (query_) => {
    try {
      const payload = JSON.parse(query_.invoice_payload || '{}');
      if (payload.action !== 'deposit') throw new Error('Invalid invoice action');
      const { rows } = await query(
        `SELECT amount, telegram_id FROM star_invoices
         WHERE id = $1 AND status = $2 AND expires_at > NOW()`,
        [payload.invoiceId, 'pending']
      );
      if (query_.currency !== 'XTR' || rows.length !== 1 || Number(rows[0].amount) !== query_.total_amount || rows[0].telegram_id !== String(query_.from.id)) {
        throw new Error('Invalid invoice payload');
      }
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
      const starsAmount = payment.total_amount;
      const payload = JSON.parse(payment.invoice_payload || '{}');

      if (payment.currency !== 'XTR' || !Number.isSafeInteger(starsAmount) || starsAmount < 1) {
        throw new Error('Invalid Stars payment');
      }

      if (payload.action !== 'deposit') throw new Error('Invalid payment action');

      const client = await getClient();
      let user;
      try {
        await client.query('BEGIN');
        const { rows: invoices } = await client.query(
          `SELECT user_id FROM star_invoices
           WHERE id = $1 AND telegram_id = $2 AND amount = $3
             AND status = 'pending'
           FOR UPDATE`,
          [payload.invoiceId, telegramId, starsAmount]
        );
        if (invoices.length !== 1) { await client.query('ROLLBACK'); return; }
        const { rows } = await client.query(`UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING id, balance`, [starsAmount, invoices[0].user_id]);
        if (!rows.length) throw new Error('Payment user not found');
        user = rows[0];
        await client.query(`UPDATE star_invoices SET status = 'paid', telegram_charge_id = $1, paid_at = NOW() WHERE id = $2`, [payment.telegram_payment_charge_id, payload.invoiceId]);
        await client.query(
          `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'deposit', $2, $3, $4, $5)`,
          [user.id, starsAmount, Number(user.balance) - starsAmount, Number(user.balance),
           JSON.stringify({ telegramPayment: true, currency: payment.currency, payload: payment.invoice_payload })]
        );
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }

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

export async function startBotPolling() {
  if (!bot) return;
  await bot.startPolling();
  console.log('[telegramBot] polling started');
}

export async function stopBotPolling() {
  if (pollingRestartTimer) {
    clearTimeout(pollingRestartTimer);
    pollingRestartTimer = undefined;
  }
  await bot?.stopPolling({ cancel: true });
}
