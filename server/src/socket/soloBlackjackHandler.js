import { getClient, query } from '../db/pool.js';
import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
import {
  createDeck, shuffleDeck, calculateScore, dealCards, isBust, resolveGame,
  MIN_BET, MAX_BET,
} from '../games/blackjack.js';

const actionLocks = new Map();

async function acquireActionLock(userId) {
  const previous = actionLocks.get(userId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => current);
  actionLocks.set(userId, queued);
  await previous.catch(() => {});

  return () => {
    release();
    if (actionLocks.get(userId) === queued) actionLocks.delete(userId);
  };
}

function shouldDealerHit(cards) {
  const score = calculateScore(cards);
  if (score < 17) return true;

  let aces = 0;
  let hard = 0;
  for (const card of cards) {
    const value = card.slice(0, -1);
    if (value === 'A') aces++;
    hard += value === 'A' ? 11 : ['J', 'Q', 'K'].includes(value) ? 10 : parseInt(value, 10);
  }
  while (hard > 21 && aces > 0) {
    hard -= 10;
    aces--;
  }
  return score === 17 && aces > 0;
}

async function loadGame(userId, txClient) {
  const { rows } = await (txClient || { query }).query(
    'SELECT game_data FROM solo_blackjack_games WHERE user_id = $1',
    [userId]
  );
  return rows[0]?.game_data || null;
}

async function saveGame(userId, state, txClient) {
  await txClient.query(
    `INSERT INTO solo_blackjack_games (user_id, game_data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET game_data = EXCLUDED.game_data, updated_at = NOW()`,
    [userId, JSON.stringify(state)]
  );
}

async function deleteGame(userId, txClient) {
  await txClient.query('DELETE FROM solo_blackjack_games WHERE user_id = $1', [userId]);
}

function publicState(state) {
  return {
    bet: state.bet,
    playerCards: state.playerCards,
    playerScore: calculateScore(state.playerCards),
    dealerCard: state.dealerCards[0],
    dealerHidden: true,
    gameOver: false,
  };
}

async function getBalance(userId) {
  const { rows } = await query('SELECT balance FROM users WHERE id = $1', [userId]);
  return rows.length ? Number(rows[0].balance) : null;
}

async function settleGame(state, userId, socket) {
  let dealerScore = calculateScore(state.dealerCards);
  while (shouldDealerHit(state.dealerCards) && state.deck.length > 0) {
    const { cards, deck } = dealCards(state.deck, 1);
    state.dealerCards.push(cards[0]);
    state.deck = deck;
    dealerScore = calculateScore(state.dealerCards);
  }

  const playerScore = calculateScore(state.playerCards);
  const { winnerId, draw } = resolveGame(
    playerScore,
    isBust(playerScore) ? 'bust' : 'stood',
    dealerScore,
    isBust(dealerScore) ? 'bust' : 'stood',
    userId,
    'dealer'
  );

  const client = await getClient();
  let payoutAmount = 0;
  let balanceAfter = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT 1 FROM solo_blackjack_games WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (!rows.length) throw new Error('Game already settled');
    if (draw) {
      const result = await payout(userId, state.bet, 'blackjack', null, client, 0);
      payoutAmount = state.bet;
      balanceAfter = result.balanceAfter;
    } else if (winnerId === userId) {
      payoutAmount = Math.ceil(state.bet * 2 * (1 - HOUSE_EDGE));
      const result = await payout(userId, payoutAmount, 'blackjack', null, client, 0);
      balanceAfter = result.balanceAfter;
    }
    await deleteGame(userId, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (balanceAfter !== null) socket.emit('balance:update', { balance: balanceAfter });
  return {
    playerCards: state.playerCards,
    playerScore,
    dealerCards: state.dealerCards,
    dealerScore,
    gameOver: true,
    winnerId,
    draw,
    payout: payoutAmount,
    bet: state.bet,
  };
}

export function registerSoloBlackjackHandlers(_io, socket) {
  const { user } = socket.data;
  const userId = user.id;

  socket.on('bj:resume', async (_payload, ack) => {
    try {
      const state = await loadGame(userId);
      if (!state) return ack?.({ active: false });
      const balance = await getBalance(userId);
      ack?.({ active: true, ...publicState(state), balance });
    } catch (err) {
      console.error('[bj:resume]', err.message);
      ack?.({ error: 'Failed to resume game' });
    }
  });

  socket.on('bj:start', async (payload, ack) => {
    const release = await acquireActionLock(userId);
    try {
      const betAmount = payload?.betAmount;
      if (!Number.isSafeInteger(betAmount) || betAmount < MIN_BET) return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      if (betAmount > MAX_BET) return ack?.({ error: `Maximum bet is ${MAX_BET}` });

      const deck = shuffleDeck(createDeck());
      const firstDeal = dealCards(deck, 2);
      const secondDeal = dealCards(firstDeal.deck, 2);
      const state = {
        userId,
        bet: betAmount,
        deck: secondDeal.deck,
        playerCards: firstDeal.cards,
        dealerCards: secondDeal.cards,
        phase: 'playing',
      };

      const client = await getClient();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT game_data FROM solo_blackjack_games WHERE user_id = $1 FOR UPDATE',
          [userId]
        );
        if (rows.length) {
          await client.query('ROLLBACK');
          const balance = await getBalance(userId);
          return ack?.({ resumed: true, ...publicState(rows[0].game_data), balance });
        }

        const held = await holdBet(userId, betAmount, 'blackjack', null, client);
        const playerScore = calculateScore(state.playerCards);
        const dealerScore = calculateScore(state.dealerCards);

        if (playerScore === 21) {
          const { winnerId, draw } = resolveGame(playerScore, 'stood', dealerScore, 'stood', userId, 'dealer');
          let payoutAmount = 0;
          let balanceAfter = held.balanceAfter;
          if (draw) {
            const result = await payout(userId, betAmount, 'blackjack', null, client, 0);
            payoutAmount = betAmount;
            balanceAfter = result.balanceAfter;
          } else if (winnerId === userId) {
            payoutAmount = Math.ceil(betAmount * 2.5 * (1 - HOUSE_EDGE));
            const result = await payout(userId, payoutAmount, 'blackjack', null, client, 0);
            balanceAfter = result.balanceAfter;
          }
          await client.query('COMMIT');
          socket.emit('balance:update', { balance: balanceAfter });
          return ack?.({
            playerCards: state.playerCards,
            playerScore,
            dealerCards: state.dealerCards,
            dealerScore,
            gameOver: true,
            winnerId,
            draw,
            payout: payoutAmount,
            bet: betAmount,
          });
        }

        await saveGame(userId, state, client);
        await client.query('COMMIT');
        socket.emit('balance:update', { balance: held.balanceAfter });
        ack?.(publicState(state));
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[bj:start]', err.message);
        ack?.({ error: err.message || 'Failed to start game' });
      } finally {
        client.release();
      }
    } finally {
      release();
    }
  });

  socket.on('bj:hit', async (_payload, ack) => {
    const release = await acquireActionLock(userId);
    try {
      const state = await loadGame(userId);
      if (!state || state.phase !== 'playing') return ack?.({ error: 'No active game' });

      const { cards, deck } = dealCards(state.deck, 1);
      const card = cards[0];
      state.playerCards.push(card);
      state.deck = deck;
      const score = calculateScore(state.playerCards);

      if (isBust(score)) {
        const client = await getClient();
        try {
          await client.query('BEGIN');
          await deleteGame(userId, client);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        const result = { card, score, bust: true, gameOver: true, playerCards: state.playerCards, dealerCards: state.dealerCards, bet: state.bet };
        socket.emit('bj:hit_result', result);
        return ack?.(result);
      }

      if (score === 21) {
        const result = await settleGame(state, userId, socket);
        socket.emit('bj:game_over', result);
        return ack?.(result);
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');
        await saveGame(userId, state, client);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      const result = { card, score, bust: false, gameOver: false, playerCards: state.playerCards };
      socket.emit('bj:hit_result', result);
      ack?.(result);
    } catch (err) {
      console.error('[bj:hit]', err.message);
      ack?.({ error: err.message || 'Failed' });
    } finally {
      release();
    }
  });

  socket.on('bj:stand', async (_payload, ack) => {
    const release = await acquireActionLock(userId);
    try {
      const state = await loadGame(userId);
      if (!state || state.phase !== 'playing') return ack?.({ error: 'No active game' });
      const result = await settleGame(state, userId, socket);
      socket.emit('bj:game_over', result);
      ack?.(result);
    } catch (err) {
      console.error('[bj:stand]', err.message);
      ack?.({ error: err.message || 'Failed' });
    } finally {
      release();
    }
  });

  socket.on('bj:double', async (_payload, ack) => {
    const release = await acquireActionLock(userId);
    try {
      const state = await loadGame(userId);
      if (!state || state.phase !== 'playing') return ack?.({ error: 'No active game' });
      if (state.playerCards.length !== 2) return ack?.({ error: 'Double only on first two cards' });

      const client = await getClient();
      try {
        await client.query('BEGIN');
        const held = await holdBet(userId, state.bet, 'blackjack', null, client);
        state.bet *= 2;
        const { cards, deck } = dealCards(state.deck, 1);
        const card = cards[0];
        state.playerCards.push(card);
        state.deck = deck;
        const score = calculateScore(state.playerCards);

        if (isBust(score)) {
          await deleteGame(userId, client);
          await client.query('COMMIT');
          socket.emit('balance:update', { balance: held.balanceAfter });
          return ack?.({ card, score, bust: true, gameOver: true, playerCards: state.playerCards, dealerCards: state.dealerCards, bet: state.bet });
        }

        await saveGame(userId, state, client);
        await client.query('COMMIT');
        socket.emit('balance:update', { balance: held.balanceAfter });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const result = await settleGame(state, userId, socket);
      socket.emit('bj:game_over', result);
      ack?.(result);
    } catch (err) {
      console.error('[bj:double]', err.message);
      ack?.({ error: err.message || 'Failed' });
    } finally {
      release();
    }
  });
}
