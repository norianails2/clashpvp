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

      if (soloGames.has(userId)) {
        soloGames.delete(userId); // cleanup stale game
      }

      const { balanceAfter } = await holdBet(userId, betAmount, 'blackjack', null, null);
      socket.emit('balance:update', { balance: balanceAfter });

      const deck = shuffleDeck(createDeck());
      const { cards: playerCards, deck: d1 } = dealCards(deck, 2);
      const { cards: dealerCards, deck: d2 } = dealCards(d1, 2);

      const playerScore = calculateScore(playerCards);
      const dealerScore = calculateScore(dealerCards);

      const game = {
        userId, betAmount,
        deck: d2,
        playerCards, playerScore,
        dealerCards, dealerScore,
        playerDone: false,
        dealerDone: false,
        active: true,
      };

      soloGames.set(userId, game);

      // If blackjack or 21 on first deal
      if (playerScore === 21) {
        game.playerDone = true;
        game.dealerDone = true;
        game.active = false;
        const { winnerId, draw } = resolveGame(playerScore, 'stood', dealerScore, 'stood', userId, 'dealer');
        if (draw) {
          const { balanceAfter } = await payout(userId, betAmount, 'blackjack', null, null, 0);
          socket.emit('balance:update', { balance: balanceAfter });
        } else if (winnerId === userId) {
          const { balanceAfter } = await payout(userId, betAmount * 2, 'blackjack', null, null, HOUSE_EDGE);
          socket.emit('balance:update', { balance: balanceAfter });
        }
        soloGames.delete(userId);
        return ack?.({
          cards: playerCards, score: playerScore,
          dealerCards, dealerScore,
          gameOver: true, winnerId, draw, payout: draw ? betAmount : (winnerId === userId ? Math.floor(betAmount * 2 * (1 - HOUSE_EDGE)) : 0),
        });
      }

      ack?.({
        cards: playerCards, score: playerScore,
        dealerCard: dealerCards[0], dealerHidden: true,
        gameOver: false,
      });
    } catch (err) {
      console.error('[bj:start]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to start blackjack' });
    }
  });

  socket.on('bj:hit', async (payload, ack) => {
    try {
      const game = soloGames.get(userId);
      if (!game || !game.active) return ack?.({ error: 'No active game' });
      if (game.playerDone) return ack?.({ error: 'You already stood' });

      const { cards: dealt, deck: newDeck } = dealCards(game.deck, 1);
      const card = dealt[0];
      game.playerCards.push(card);
      game.deck = newDeck;
      const score = calculateScore(game.playerCards);

      if (isBust(score)) {
        game.playerDone = true;
        game.dealerDone = true;
        game.active = false;
        soloGames.delete(userId);
        return ack?.({ card, score, bust: true, gameOver: true, winnerId: 'dealer', playerCards: game.playerCards, dealerCards: game.dealerCards });
      }

      if (score === 21) {
        game.playerDone = true;
        game.dealerDone = true;
        game.active = false;
        // Player stands automatically at 21, then dealer plays
        await playDealer(game, userId, ack);
        return;
      }

      ack?.({ card, score, bust: false, gameOver: false });
    } catch (err) {
      console.error('[bj:hit]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to hit' });
    }
  });

  socket.on('bj:stand', async (payload, ack) => {
    try {
      const game = soloGames.get(userId);
      if (!game || !game.active) return ack?.({ error: 'No active game' });
      if (game.playerDone) return ack?.({ error: 'Already stood' });

      game.playerDone = true;
      await playDealer(game, userId, ack);
    } catch (err) {
      console.error('[bj:stand]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to stand' });
    }
  });

  socket.on('disconnect', () => {
    // Keep game alive for reconnection
  });
}

async function playDealer(game, userId, ack) {
  let dealerScore = calculateScore(game.dealerCards);
  while (dealerScore < 17) {
    const { cards: dealt, deck: newDeck } = dealCards(game.deck, 1);
    game.dealerCards.push(dealt[0]);
    game.deck = newDeck;
    dealerScore = calculateScore(game.dealerCards);
  }

  game.dealerDone = true;
  game.active = false;

  const dealerBust = isBust(dealerScore);
  const dealerStatus = dealerBust ? 'bust' : 'stood';
  const playerScore = calculateScore(game.playerCards);
  const playerBust = isBust(playerScore);
  const playerStatus = playerBust ? 'bust' : 'stood';

  const { winnerId, draw } = resolveGame(playerScore, playerStatus, dealerScore, dealerStatus, userId, 'dealer');

  if (draw) {
    const { balanceAfter: balanceAfterDraw } = await payout(userId, game.betAmount, 'blackjack', null, null, 0);
    socket.emit('balance:update', { balance: balanceAfterDraw });
  } else if (winnerId === userId) {
    const winAmount = Math.floor(game.betAmount * 2 * (1 - HOUSE_EDGE));
    const { balanceAfter } = await payout(userId, winAmount, 'blackjack', null, null, 0);
    socket.emit('balance:update', { balance: balanceAfter });
    soloGames.delete(userId);
    return ack?.({
      playerCards: game.playerCards, playerScore,
      dealerCards: game.dealerCards, dealerScore,
      gameOver: true, winnerId, draw: false,
      payout: winAmount,
    });
  }

  soloGames.delete(userId);
  ack?.({
    playerCards: game.playerCards, playerScore,
    dealerCards: game.dealerCards, dealerScore,
    gameOver: true, winnerId: draw ? null : 'dealer', draw,
    payout: draw ? game.betAmount : 0,
  });
}
