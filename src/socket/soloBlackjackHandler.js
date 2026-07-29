import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
import {
  createDeck, shuffleDeck, calculateScore, dealCards, isBlackjack, isBust, resolveGame,
  MIN_BET, MAX_BET,
} from '../games/blackjack.js';

const soloGames = new Map();

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

      if (playerScore === 21) {
        const { winnerId, draw } = resolveGame(playerScore, 'stood', dealerScore, 'stood', userId, 'dealer');
        let payoutAmount = 0;
        if (draw) {
          const r = await payout(userId, betAmount, 'blackjack', null, null, 0);
          socket.emit('balance:update', { balance: r.balanceAfter });
          payoutAmount = betAmount;
        } else if (winnerId === userId) {
          const winAmount = Math.floor(betAmount * 2 * (1 - HOUSE_EDGE));
          const r = await payout(userId, winAmount, 'blackjack', null, null, HOUSE_EDGE);
          socket.emit('balance:update', { balance: r.balanceAfter });
          payoutAmount = winAmount;
        }
        return ack?.({ cards: playerCards, score: playerScore, dealerCards, dealerScore, gameOver: true, winnerId, draw, payout: payoutAmount });
      }

      const game = { userId, betAmount, deck: d2, playerCards, playerScore, dealerCards, dealerScore, playerDone: false, active: true };
      soloGames.set(userId, game);

      ack?.({ cards: playerCards, score: playerScore, dealerCard: dealerCards[0], dealerHidden: true, gameOver: false });
    } catch (err) {
      console.error('[bj:start]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to start blackjack' });
    }
  });

  socket.on('bj:hit', async (payload, ack) => {
    try {
      const game = soloGames.get(userId);
      if (!game || !game.active) {
        socket.emit('bj:hit_resp', { error: 'No active game' });
        return ack?.({ error: 'No active game' });
      }
      if (game.playerDone) {
        socket.emit('bj:hit_resp', { error: 'You already stood' });
        return ack?.({ error: 'You already stood' });
      }

      const { cards: dealt, deck: newDeck } = dealCards(game.deck, 1);
      const card = dealt[0];
      game.playerCards.push(card);
      game.deck = newDeck;
      const score = calculateScore(game.playerCards);

      if (isBust(score)) {
        game.active = false;
        soloGames.delete(userId);
        const resp = { card, score, bust: true, gameOver: true, winnerId: 'dealer', playerCards: game.playerCards, dealerCards: game.dealerCards };
        socket.emit('bj:hit_resp', resp);
        return ack?.(resp);
      }

      if (score === 21) {
        game.active = false;
        game.playerDone = true;
        const result = await runDealer(game, userId, socket);
        socket.emit('bj:hit_resp', result);
        return ack?.(result);
      }

      const resp = { card, score, bust: false, gameOver: false, playerCards: game.playerCards };
      socket.emit('bj:hit_resp', resp);
      ack?.(resp);
    } catch (err) {
      console.error('[bj:hit]', err?.message || err);
      const errResp = { error: err?.message || 'Failed to hit' };
      socket.emit('bj:hit_resp', errResp);
      ack?.(errResp);
    }
  });

  socket.on('bj:stand', async (payload, ack) => {
    try {
      const game = soloGames.get(userId);
      if (!game || !game.active) {
        socket.emit('bj:stand_resp', { error: 'No active game' });
        return ack?.({ error: 'No active game' });
      }
      if (game.playerDone) {
        socket.emit('bj:stand_resp', { error: 'Already stood' });
        return ack?.({ error: 'Already stood' });
      }

      game.playerDone = true;
      game.active = false;
      const result = await runDealer(game, userId, socket);
      socket.emit('bj:stand_resp', result);
      ack?.(result);
    } catch (err) {
      console.error('[bj:stand]', err?.message || err);
      const errResp = { error: err?.message || 'Failed to stand' };
      socket.emit('bj:stand_resp', errResp);
      ack?.(errResp);
    }
  });

  socket.on('disconnect', () => {});
}

async function runDealer(game, userId, socket) {
  let dealerScore = calculateScore(game.dealerCards);
  while (dealerScore < 17) {
    const { cards: dealt, deck: newDeck } = dealCards(game.deck, 1);
    game.dealerCards.push(dealt[0]);
    game.deck = newDeck;
    dealerScore = calculateScore(game.dealerCards);
  }
  soloGames.delete(userId);

  const dealerBust = isBust(dealerScore);
  const dealerStatus = dealerBust ? 'bust' : 'stood';
  const playerScore = calculateScore(game.playerCards);
  const playerBust = isBust(playerScore);
  const playerStatus = playerBust ? 'bust' : 'stood';
  const { winnerId, draw } = resolveGame(playerScore, playerStatus, dealerScore, dealerStatus, userId, 'dealer');

  let payoutAmount = 0;
  if (draw) {
    const r = await payout(userId, game.betAmount, 'blackjack', null, null, 0);
    socket.emit('balance:update', { balance: r.balanceAfter });
    payoutAmount = game.betAmount;
  } else if (winnerId === userId) {
    const winAmount = Math.floor(game.betAmount * 2 * (1 - HOUSE_EDGE));
    const r = await payout(userId, winAmount, 'blackjack', null, null, 0);
    socket.emit('balance:update', { balance: r.balanceAfter });
    payoutAmount = winAmount;
  }

  return {
    playerCards: game.playerCards, playerScore,
    dealerCards: game.dealerCards, dealerScore,
    gameOver: true, winnerId: draw ? null : 'dealer', draw,
    payout: payoutAmount,
  };
}
