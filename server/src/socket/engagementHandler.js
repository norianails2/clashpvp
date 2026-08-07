import { getClient, query } from '../db/pool.js';

const DAILY_REWARD = 2;
const DAILY_TASKS = [
  { key: 'daily', title: 'Ежедневный бонус', description: 'Зайди в игру и забери бонус', reward: DAILY_REWARD, target: 1 },
  { key: 'bets_3', title: 'Сыграй 3 раунда', description: '3 ставки с общим оборотом от 30 Stars', reward: 3, target: 3 },
  { key: 'turnover_100', title: 'Оборот 250 Stars', description: 'Поставь суммарно 250 Stars за день', reward: 7, target: 250 },
  { key: 'win_1', title: 'Первая победа', description: 'Выиграй любой раунд сегодня', reward: 2, target: 1 },
  { key: 'referral', title: 'Пригласи друга', description: 'Друг должен открыть приложение по твоей ссылке', reward: 50, target: 1, action: 'share' }
];

async function getTaskStatuses(client, userId) {
  const [{ rows: activityRows }, { rows: claimRows }, { rows: dailyRows }, { rows: referralRows }] = await Promise.all([
    client.query(
      `SELECT COUNT(*) FILTER (WHERE type = 'bet' AND created_at >= CURRENT_DATE)::int AS bets,
              COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'bet' AND created_at >= CURRENT_DATE), 0)::int AS turnover,
              COUNT(*) FILTER (WHERE type = 'win' AND created_at >= CURRENT_DATE)::int AS wins
       FROM transactions WHERE user_id = $1`, [userId]
    ),
    client.query('SELECT task_key FROM engagement_task_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE', [userId]),
    client.query('SELECT claim_date = CURRENT_DATE AS claimed FROM daily_reward_claims WHERE user_id = $1', [userId]),
    client.query('SELECT COUNT(*)::int AS total FROM users WHERE referrer_id = $1', [userId])
  ]);
  const activity = activityRows[0] || {};
  const claimed = new Set(claimRows.map((row) => row.task_key));
  const values = { daily: 1, bets_3: Number(activity.bets || 0), turnover_100: Number(activity.turnover || 0), win_1: Number(activity.wins || 0), referral: Number(referralRows[0]?.total || 0) };
  return DAILY_TASKS.map((task) => {
    const isThreeRounds = task.key === 'bets_3';
    const progress = Math.min(values[task.key] || 0, task.target);
    const ready = task.action ? false : isThreeRounds
      ? values.bets_3 >= 3 && values.turnover_100 >= 30
      : (values[task.key] || 0) >= task.target;
    return {
      ...task,
      progress,
      progressLabel: isThreeRounds ? `${Math.min(values.bets_3, 3)}/3 ставок · ${Math.min(values.turnover_100, 30)}/30` : `${progress}/${task.target}`,
      progressPercent: isThreeRounds
        ? Math.min(100, Math.min(values.bets_3 / 3, values.turnover_100 / 30) * 100)
        : Math.min(100, ((values[task.key] || 0) / task.target) * 100),
      claimed: task.key === 'daily' ? Boolean(dailyRows[0]?.claimed) : claimed.has(task.key),
      ready
    };
  });
}

async function creditTaskReward(client, userId, task) {
  const { rows: users } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
  const balanceBefore = Number(users[0].balance);
  const balanceAfter = balanceBefore + task.reward;
  await client.query('UPDATE users SET balance = $1 WHERE id = $2', [balanceAfter, userId]);
  await client.query(
    `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
     VALUES ($1, 'task_reward', $2, $3, $4, $5)`,
    [userId, task.reward, balanceBefore, balanceAfter, JSON.stringify({ task: task.key })]
  );
  return balanceAfter;
}

export function registerEngagementHandlers(io, socket) {
  const userId = socket.data.user.id;

  socket.on('engagement:leaderboard', async (_payload, ack) => {
    try {
      const { rows } = await query(
        `SELECT COALESCE(NULLIF(u.username, ''), NULLIF(u.first_name, ''), 'Player') AS name,
                COALESCE(SUM(t.amount), 0)::bigint AS won_stars
         FROM users u
         JOIN transactions t ON t.user_id = u.id AND t.type = 'win'
         GROUP BY u.id, u.username, u.first_name
         ORDER BY won_stars DESC, u.created_at ASC
         LIMIT 20`
      );
      ack?.({ players: rows.map((row, index) => ({ rank: index + 1, ...row })) });
    } catch (err) { ack?.({ error: 'Failed to load leaderboard' }); }
  });

  socket.on('engagement:daily_status', async (_payload, ack) => {
    try {
      const { rows } = await query('SELECT claim_date = CURRENT_DATE AS claimed FROM daily_reward_claims WHERE user_id = $1', [userId]);
      ack?.({ claimed: Boolean(rows[0]?.claimed), reward: DAILY_REWARD });
    } catch (err) { ack?.({ error: 'Failed to load task status' }); }
  });

  socket.on('engagement:tasks_status', async (_payload, ack) => {
    try { ack?.({ tasks: await getTaskStatuses({ query }, userId) }); }
    catch (err) { ack?.({ error: 'Failed to load tasks' }); }
  });

  socket.on('engagement:claim_daily', async (_payload, ack) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const task = DAILY_TASKS[0];
      const { rows: claims } = await client.query(
        `INSERT INTO daily_reward_claims (user_id, claim_date, claimed_at) VALUES ($1, CURRENT_DATE, NOW())
         ON CONFLICT (user_id) DO UPDATE SET claim_date = CURRENT_DATE, claimed_at = NOW()
         WHERE daily_reward_claims.claim_date < CURRENT_DATE RETURNING claim_date`,
        [userId]
      );
      if (!claims.length) throw new Error('Reward already claimed today');
      const balanceAfter = await creditTaskReward(client, userId, task);
      await client.query('COMMIT');
      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ success: true, reward: DAILY_REWARD, balance: balanceAfter });
    } catch (err) {
      await client.query('ROLLBACK');
      ack?.({ error: err.message || 'Failed to claim reward' });
    } finally { client.release(); }
  });

  socket.on('engagement:claim_task', async ({ key } = {}, ack) => {
    const task = DAILY_TASKS.find((item) => item.key === key && item.key !== 'daily' && !item.action);
    if (!task) return ack?.({ error: 'Task is not available' });
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const tasks = await getTaskStatuses(client, userId);
      const state = tasks.find((item) => item.key === task.key);
      if (!state?.ready) throw new Error('Условие задания ещё не выполнено');
      if (state.claimed) throw new Error('Награда уже получена');
      const { rows } = await client.query(
        `INSERT INTO engagement_task_claims (user_id, task_key, claim_date)
         VALUES ($1, $2, CURRENT_DATE) ON CONFLICT DO NOTHING RETURNING task_key`,
        [userId, task.key]
      );
      if (!rows.length) throw new Error('Награда уже получена');
      const balanceAfter = await creditTaskReward(client, userId, task);
      await client.query('COMMIT');
      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ success: true, reward: task.reward, balance: balanceAfter });
    } catch (err) {
      await client.query('ROLLBACK');
      ack?.({ error: err.message || 'Failed to claim task reward' });
    } finally { client.release(); }
  });
}
