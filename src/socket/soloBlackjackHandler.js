// ================================================================
//  SOLO PvE BLACKJACK HANDLER – против дилера, со ставками из баланса
// ================================================================

import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
import {
  createDeck, shuffleDeck, calculateScore, dealCards, isBust, isBlackjack, resolveGame,
  MIN_BET, MAX_BET,
} from '../games/blackjack.js';

const soloGames = new Map();

function shouldDealerHit(cards) {
  const score = calculateScore(cards);
  if (score < 17) return true;
  // Soft 17 — count aces
  let aces = 0, hard = 0;
  for (const c of cards) {
    const val = c.slice(0, -1);
    if (val === 'A') aces++;
    hard += (val === 'A' ? 11 : ['J','Q','K'].includes(val) ? 10 : parseInt(val, 10));
  }
  while (hard > 21 && aces > 0) { hard -= 10; aces--; }
  if (score === 17 && aces > 0) return true; // soft 17
  return false;
}

export function registerSoloBlackjackHandlers(io, socket) {
  const { user } = socket.data;
  const userId = user.id;

  socket.on('bj:start', async (payload, ack) => {
    try {
      const { betAmount } = payload || {};
      if (!betAmount || betAmount < MIN_BET) return ack?.({ error: 'Minimum bet is ' + MIN_BET });
      if (betAmount > MAX_BET) return ack?.({ error: 'Maximum bet is ' + MAX_BET });

      if (soloGames.has(userId)) soloGames.delete(userId);

      const { balanceAfter } = await holdBet(userId, betAmount, 'blackjack', null, null);
      socket.emit('balance:update', { balance: balanceAfter });

      const deck = shuffleDeck(createDeck());
      const { cards: playerCards, deck: d1 } = dealCards(deck, 2);
      const { cards: dealerCards, deck: d2 } = dealCards(d1, 2);
      const playerScore = calculateScore(playerCards);
      const dealerScore = calculateScore(dealerCards);

      const state = {
        userId, bet: betAmount,
        deck: d2, playerCards, dealerCards,
        playerScore, dealerScore,
        phase: 'playing', // playing | dealer_turn | finished
        over: false,
      };
      soloGames.set(userId, state);

      // Check for instant blackjack
      if (playerScore === 21) {
        const { winnerId, draw } = resolveGame(playerScore, 'stood', dealerScore, 'stood', userId, 'dealer');
        let payoutAmt = 0;
        if (draw) {
          const r = await payout(userId, betAmount, 'blackjack', null, null, 0);
          socket.emit('balance:update', { balance: r.balanceAfter });
          payoutAmt = betAmount;
        } else if (winnerId === userId) {
          const win = Math.floor(betAmount * 2.5 * (1 - HOUSE_EDGE)); // blackjack pays 3:2
          const r = await payout(userId, win, 'blackjack', null, null, HOUSE_EDGE);
          socket.emit('balance:update', { balance: r.balanceAfter });
          payoutAmt = win;
        }
        state.over = true;
        state.phase = 'finished';
        soloGames.delete(userId);
        return ack?.({
          playerCards, playerScore,
          dealerCards, dealerScore,
          gameOver: true, winnerId, draw, payout: payoutAmt,
        });
      }

      ack?.({
        playerCards, playerScore,
        dealerCard: dealerCards[0], dealerHidden: true,
        gameOver: false,
      });
    } catch (err) {
      console.error('[bj:start]', err?.message || err);
      ack?.({ error: err?.message || 'Failed' });
    }
  });

  socket.on('bj:hit', async (payload, ack) => {
    try {
      const state = soloGames.get(userId);
      if (!state || state.phase !== 'playing') {
        const r = { error: 'No active game' };
        socket.emit('bj:hit_result', r);
        return ack?.(r);
      }

      const { cards: dealt, deck: newDeck } = dealCards(state.deck, 1);
      const card = dealt[0];
      state.playerCards.push(card);
      state.deck = newDeck;
      const score = calculateScore(state.playerCards);

      if (isBust(score)) {
        state.phase = 'finished'; state.over = true;
        soloGames.delete(userId);
        const r = { card, score, bust: true, gameOver: true, playerCards: state.playerCards, dealerCards: state.dealerCards };
        socket.emit('bj:hit_result', r);
        return ack?.(r);
      }

      if (score === 21) {
        state.phase = 'dealer_turn';
        await playDealer(state, userId, socket);
        soloGames.delete(userId);
        return;
      }

      const r = { card, score, bust: false, gameOver: false, playerCards: state.playerCards };
      socket.emit('bj:hit_result', r);
      ack?.(r);
    } catch (err) {
      console.error('[bj:hit]', err?.message || err);
      const r = { error: err?.message || 'Failed' };
      socket.emit('bj:hit_result', r);
      ack?.(r);
    }
  });

  socket.on('bj:stand', async (payload, ack) => {
    try {
      const state = soloGames.get(userId);
      if (!state || state.phase !== 'playing') {
        const r = { error: 'No active game' };
        socket.emit('bj:stand_result', r);
        return ack?.(r);
      }

      state.phase = 'dealer_turn';
      await playDealer(state, userId, socket);
      soloGames.delete(userId);
      ack?.({ gameOver: true });
    } catch (err) {
      console.error('[bj:stand]', err?.message || err);
      const r = { error: err?.message || 'Failed' };
      socket.emit('bj:stand_result', r);
      ack?.(r);
    }
  });

  socket.on('bj:double', async (payload, ack) => {
    try {
      const state = soloGames.get(userId);
      if (!state || state.phase !== 'playing') {
        const r = { error: 'No active game' };
        return ack?.(r);
      }
      if (state.playerCards.length !== 2) {
        const r = { error: 'Double only on first two cards' };
        return ack?.(r);
      }

      // Hold extra bet
      const { balanceAfter } = await holdBet(userId, state.bet, 'blackjack', null, null);
      socket.emit('balance:update', { balance: balanceAfter });
      state.bet *= 2;

      const { cards: dealt, deck: newDeck } = dealCards(state.deck, 1);
      const card = dealt[0];
      state.playerCards.push(card);
      state.deck = newDeck;
      const score = calculateScore(state.playerCards);

      if (isBust(score)) {
        state.phase = 'finished'; state.over = true;
        soloGames.delete(userId);
        const r = { card, score, bust: true, gameOver: true, playerCards: state.playerCards, dealerCards: state.dealerCards };
        return ack?.(r);
      }

      // Auto-stand after double
      state.phase = 'dealer_turn';
      await playDealer(state, userId, socket);
      soloGames.delete(userId);
      ack?.({ card, score, gameOver: true });
    } catch (err) {
      console.error('[bj:double]', err?.message || err);
      ack?.({ error: err?.message || 'Failed' });
    }
  });

  socket.on('disconnect', () => {
    soloGames.delete(userId);
  });
}

async function playDealer(state, userId, socket) {
  let dealerScore = calculateScore(state.dealerCards);
  while (shouldDealerHit(state.dealerCards) && state.deck.length > 0) {
    const { cards: dealt, deck: newDeck } = dealCards(state.deck, 1);
    state.dealerCards.push(dealt[0]);
    state.deck = newDeck;
    dealerScore = calculateScore(state.dealerCards);
  }

  state.phase = 'finished'; state.over = true;
  const playerScore = calculateScore(state.playerCards);
  const playerBust = isBust(playerScore);
  const dealerBust = isBust(dealerScore);
  const { winnerId, draw } = resolveGame(playerScore, playerBust ? 'bust' : 'stood', dealerScore, dealerBust ? 'bust' : 'stood', userId, 'dealer');

  let payoutAmt = 0;
  if (draw) {
    const r = await payout(userId, state.bet, 'blackjack', null, null, 0);
    socket.emit('balance:update', { balance: r.balanceAfter });
    payoutAmt = state.bet;
  } else if (winnerId === userId) {
    const win = Math.floor(state.bet * 2 * (1 - HOUSE_EDGE));
    const r = await payout(userId, win, 'blackjack', null, null, 0);
    socket.emit('balance:update', { balance: r.balanceAfter });
    payoutAmt = win;
  }

  socket.emit('bj:game_over', {
    playerCards: state.playerCards, playerScore,
    dealerCards: state.dealerCards, dealerScore,
    gameOver: true, winnerId, draw,
    payout: payoutAmt, bet: state.bet,
  });
}
