import { createHmac } from 'crypto';

function validateTelegramData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(sorted).digest('hex');
  return computed === hash;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { initData, transaction_id, amount, user_id, user_name } = req.body;
  if (!transaction_id || !amount || !user_id || !initData) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: 'BOT_TOKEN not configured in Vercel env' });

  if (!validateTelegramData(initData, BOT_TOKEN)) {
    return res.status(403).json({ error: 'Invalid Telegram data' });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (SUPABASE_URL && SUPABASE_KEY) {
      const headers = {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      };

      const userResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, { headers }).then(r => r.json());
      const user = Array.isArray(userResp) ? userResp[0] : null;

      if (user) {
        const cur = (user.stars_balance || user.balance || 0) + amount;
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ stars_balance: cur, balance: cur })
        });

        await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id, type: 'deposit', amount, currency: 'stars',
            description: `Telegram Stars purchase: ${transaction_id}`
          })
        });
      }
    }

    return res.json({ ok: true, credited: amount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
