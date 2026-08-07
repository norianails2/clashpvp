const LEVEL_RATES = [0.03, 0.01, 0.005];

export const referralCommissionRates = LEVEL_RATES;

export async function distributeLossCommissions(client, { lossKey, sourceUserId, lossAmount, gameType = null }) {
  if (!lossKey || !sourceUserId || !Number.isSafeInteger(lossAmount) || lossAmount < 1) return [];

  const paid = [];
  let childId = sourceUserId;
  const visited = new Set([sourceUserId]);

  for (let index = 0; index < LEVEL_RATES.length; index += 1) {
    const { rows } = await client.query('SELECT referrer_id FROM users WHERE id = $1', [childId]);
    const beneficiaryId = rows[0]?.referrer_id;
    if (!beneficiaryId || visited.has(beneficiaryId)) break;
    visited.add(beneficiaryId);
    childId = beneficiaryId;

    const amount = Math.floor(lossAmount * LEVEL_RATES[index]);
    if (amount < 1) continue;
    const level = index + 1;
    const inserted = await client.query(
      `INSERT INTO referral_loss_commissions
         (loss_key, level, source_user_id, beneficiary_id, loss_amount, commission_amount, game_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING RETURNING commission_amount`,
      [lossKey, level, sourceUserId, beneficiaryId, lossAmount, amount, gameType]
    );
    if (!inserted.rowCount) continue;

    const { rows: updated } = await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [amount, beneficiaryId]
    );
    const balanceAfter = Number(updated[0].balance);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_type, metadata)
       VALUES ($1, 'referral_commission', $2, $3, $4, $5, $6)`,
      [beneficiaryId, amount, balanceAfter - amount, balanceAfter, gameType,
       JSON.stringify({ level, sourceUserId, lossAmount, rate: LEVEL_RATES[index], lossKey })]
    );
    paid.push({ beneficiaryId, amount, level });
  }
  return paid;
}
