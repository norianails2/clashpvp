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

      const miniAppUrl = process.env.MINI_APP_URL || `https://clashpvp-production.up.railway.app`;

      await bot.sendMessage(chatId,
        `🎲 Welcome to *Clash PVP Casino!*\n\n` +
        `💰 *Games:* RPS, Dice, Coin, Mines, Blackjack, Crash\n` +
        `🎯 *House edge:* 10%\n\n` +
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
      `📋 *Правила платформы — Clash PVP*\n\n` +
      `*1. Общие положения*\n` +
      `Сервис Clash PVP предоставляет развлекательные PvP-мини-игры, где участники могут соревноваться друг с другом, используя внутреннюю валюту Stars. Участие в играх является добровольным.\n` +
      `Платформа предназначена исключительно для развлечения. Используя её, вы соглашаетесь с настоящими правилами.\n` +
      `Администрация оставляет за собой право изменять правила без предварительного уведомления.\n` +
      `Минимальный возраст для использования платформы — 18 лет.\n\n` +
      `*2. Как работают игры*\n` +
      `*Камень-Ножницы-Бумага (RPS)*\n` +
      `Классическая дуэль. Выбираете ход (✊✋✌️), соперник выбирает случайно. Победитель забирает ставку ×2. Ничья — возврат. Комиссия платформы: 10% с выигрыша.\n\n` +
      `*Кости (Dice)*\n` +
      `Каждый бросает кубик (1-6). У кого больше — победил. Совпадение — ничья. Комиссия: 10%.\n\n` +
      `*Монетка (Coin)*\n` +
      `Угадай Орла 🦅 или Решку 🪙. Угадал — забираешь ставку ×2 минус 10% комиссия.\n\n` +
      `*Мины (Mines)*\n` +
      `На поле 3×3 спрятаны 1 бомба и 8 алмазов. Открывайте клетки по очереди. Наткнулись на бомбу — проиграли. Собрали больше алмазов — победили. Комиссия: 10%.\n\n` +
      `*Блекджек (Blackjack)*\n` +
      `Собери 21 или ближе к 21, чем соперник. Hit — ещё карта, Stand — хватит. Перебор >21 — проигрыш. Комиссия: 10%.\n\n` +
      `*Ракетка (Crash)*\n` +
      `Множитель растёт с 1.00×. Забери деньги до взрыва. Не успел — ставка сгорает. Provably Fair (HMAC-SHA256) — каждый раунд можно проверить. Комиссия встроена в алгоритм (10%).\n\n` +
      `*3. Финансы и баланс*\n` +
      `Stars (Звёзды) списываются безвозвратно в момент ставки. Нажимая кнопку участия, вы соглашаетесь с тем, что потраченные средства списываются немедленно.\n` +
      `В случае проигрыша в любой из игр средства не возвращаются. Вы платите за участие и шанс выиграть, а не за гарантированный приз.\n` +
      `Вывод средств не предусмотрен. Stars приобретаются через Telegram и используются только внутри платформы.\n` +
      `Администрация вправе заморозить баланс при подозрении на мошенничество.\n` +
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
      `Используя платформу Clash PVP, вы подтверждаете, что ознакомились с данными правилами и принимаете их в полном объёме.\n\n` +
      `📞 *Поддержка:* @ama833`,
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
