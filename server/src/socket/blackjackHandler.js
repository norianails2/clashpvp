import { getClient } from '../db/pool.js';
import { holdBet, payout, refund, HOUSE_EDGE } from '../services/balanceService.js';
import { createRoom } from '../services/roomService.js';
import { distributeLossCommissions } from '../services/referralCommissionService.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';
import {
  createDeck,
  shuffleDeck,
  calculateScore,
  dealCards,
  isBust,
  resolveGame,
  MIN_BET, MAX_BET,
} from '../games/blackjack.js';

export function registerBlackjackHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('blackjack:create_room', async (payload, ack) => {
    try {
      const { betAmount } = payload || {};

      if (!betAmount || betAmount < MIN_BET) {
        return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      }
      if (betAmount > MAX_BET) {
        return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      }

      const deck = shuffleDeck(createDeck());
      const { cards: creatorCards, deck: remaining } = dealCards(deck, 2);
      const creatorScore = calculateScore(creatorCards);

      const gameData = {
        deck: remaining,
        creatorCards,
        creatorScore,
        creatorStatus: creatorScore === 21 ? 'stood' : 'active',
        opponentCards: [],
        opponentScore: 0,
        opponentStatus: 'waiting',
      };

      const room = await createRoom(user.id, 'blackjack', betAmount, gameData);

      socket.join(`room:${room.id}`);

      ack?.({
        roomId: room.id,
        cards: creatorCards,
        score: creatorScore,
      });

      broadcastLobbyUpdate(io, 'blackjack');
    } catch (err) {
      console.error('[blackjack:create_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to create blackjack room' });
    }
  });

  socket.on('blackjack:join_room', async (payload, ack) => {
    try {
      const { roomId } = payload || {};

      if (!roomId) {
        return ack?.({ error: 'Room ID is required' });
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');

        const { rows: roomRows } = await client.query(
          `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
          [roomId]
        );

        if (roomRows.length === 0) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room not found' });
        }

        const room = roomRows[0];

        if (room.status !== 'WAITING') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is not available' });
        }

        if (room.creator_id === user.id) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Cannot join your own room' });
        }

        if (room.game_type !== 'blackjack') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is not a blackjack game' });
        }

        await holdBet(user.id, room.bet_amount, 'blackjack', room.id, client);

        const gameData = room.game_data || {};
        const { deck: remainingDeck, creatorCards, creatorScore, creatorStatus } = gameData;

        const { cards: opponentCards, deck: finalDeck } = dealCards(remainingDeck, 2);
        const opponentScore = calculateScore(opponentCards);
        const opponentStatus = opponentScore === 21 ? 'stood' : 'active';

        const updatedData = {
          deck: finalDeck,
          creatorCards,
          creatorScore,
          creatorStatus,
          opponentCards,
          opponentScore,
          opponentStatus,
        };

        const openingIsOver = creatorStatus === 'stood' && opponentStatus === 'stood';
        let openingResult = null;

        if (openingIsOver) {
          openingResult = resolveGame(
            creatorScore, creatorStatus,
            opponentScore, opponentStatus,
            room.creator_id, user.id
          );

          if (openingResult.draw) {
            await refund(room.creator_id, room.bet_amount, 'blackjack', room.id, client);
            await refund(user.id, room.bet_amount, 'blackjack', room.id, client);
          } else {
            await payout(openingResult.winnerId, room.bet_amount * 2, 'blackjack', room.id, client, HOUSE_EDGE);
            const loserId = openingResult.winnerId === room.creator_id ? user.id : room.creator_id;
            await distributeLossCommissions(client, { lossKey: `room:${room.id}:${loserId}`, sourceUserId: loserId, lossAmount: Number(room.bet_amount), gameType: 'blackjack' });
          }

          updatedData.winnerId = openingResult.winnerId;
          updatedData.draw = openingResult.draw;
          delete updatedData.deck;
        } else {
          // A creator blackjack is already stood, so the opponent must take the first turn.
          updatedData.currentTurn = creatorStatus === 'active' ? room.creator_id : user.id;
        }

        await client.query(
           `UPDATE rooms
           SET status = $1,
               opponent_id = $2,
               game_data = $3::jsonb
           WHERE id = $4`,
          [openingIsOver ? 'FINISHED' : 'IN_PROGRESS', user.id, JSON.stringify(updatedData), room.id]
        );

        await client.query('COMMIT');

        socket.join(`room:${room.id}`);

        io.to(`room:${room.id}`).emit('blackjack:game_started', {
          roomId: room.id,
          creatorId: room.creator_id,
          creatorCards,
          creatorScore,
          creatorStatus,
          opponentCards,
          opponentScore,
          opponentStatus,
          currentTurn: updatedData.currentTurn || null,
        });

        if (openingResult) {
          io.to(`room:${room.id}`).emit('blackjack:game_over', {
            roomId: room.id,
            winnerId: openingResult.winnerId,
            draw: openingResult.draw,
            creatorCards,
            creatorScore,
            opponentCards,
            opponentScore,
            payout: openingResult.draw ? room.bet_amount : Math.ceil(room.bet_amount * 2 * (1 - HOUSE_EDGE)),
          });
        }

        ack?.({
          cards: opponentCards,
          score: opponentScore,
        });

        broadcastLobbyUpdate(io, 'blackjack');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[blackjack:join_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to join blackjack room' });
    }
  });

  socket.on('blackjack:hit', async (payload, ack) => {
    try {
      const { roomId } = payload || {};

      if (!roomId) {
        return ack?.({ error: 'Room ID is required' });
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');

        const { rows: roomRows } = await client.query(
          `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
          [roomId]
        );

        if (roomRows.length === 0) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room not found' });
        }

        const room = roomRows[0];

        if (room.status !== 'IN_PROGRESS') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Game is not in progress' });
        }

        const gd = room.game_data || {};

        if (gd.currentTurn !== user.id) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Not your turn' });
        }

        const isCreator = user.id === room.creator_id;
        const playerKey = isCreator ? 'creator' : 'opponent';

        if (gd[`${playerKey}Status`] !== 'active') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'You cannot hit right now' });
        }

        const { cards: drawn, deck: finalDeck } = dealCards(gd.deck, 1);
        const card = drawn[0];
        const updatedCards = [...(gd[`${playerKey}Cards`] || []), card];
        const newScore = calculateScore(updatedCards);
        const bust = isBust(newScore);

        const updatedData = {
          ...gd,
          deck: finalDeck,
          [`${playerKey}Cards`]: updatedCards,
          [`${playerKey}Score`]: newScore,
          [`${playerKey}Status`]: bust ? 'bust' : (newScore === 21 ? 'stood' : 'active'),
        };

        const otherKey = isCreator ? 'opponent' : 'creator';
        const otherStatus = updatedData[`${otherKey}Status`];
        const newStatus = updatedData[`${playerKey}Status`];

        if ((newStatus === 'bust' || newStatus === 'stood') && (otherStatus === 'bust' || otherStatus === 'stood')) {
          const resolved = resolveGame(
            updatedData.creatorScore, updatedData.creatorStatus,
            updatedData.opponentScore, updatedData.opponentStatus,
            room.creator_id, room.opponent_id
          );

          if (resolved.draw) {
            await refund(room.creator_id, room.bet_amount, 'blackjack', room.id, client);
            await refund(room.opponent_id, room.bet_amount, 'blackjack', room.id, client);
          } else {
            await payout(resolved.winnerId, room.bet_amount * 2, 'blackjack', room.id, client, HOUSE_EDGE);
            const loserId = resolved.winnerId === room.creator_id ? room.opponent_id : room.creator_id;
            await distributeLossCommissions(client, { lossKey: `room:${room.id}:${loserId}`, sourceUserId: loserId, lossAmount: Number(room.bet_amount), gameType: 'blackjack' });
          }

          updatedData.winnerId = resolved.winnerId;
          updatedData.draw = resolved.draw;
          delete updatedData.deck;

          await client.query(
            `UPDATE rooms
             SET status = 'FINISHED',
                 winner_id = $1,
                 game_data = $2::jsonb
             WHERE id = $3`,
            [resolved.winnerId, JSON.stringify(updatedData), room.id]
          );

          await client.query('COMMIT');

          io.to(`room:${room.id}`).emit('blackjack:card_dealt', {
            roomId,
            playerId: user.id,
            card,
            hand: updatedCards,
            score: newScore,
            bust,
          });

          io.to(`room:${room.id}`).emit('blackjack:game_over', {
            roomId: room.id,
            winnerId: resolved.winnerId,
            draw: resolved.draw,
            creatorCards: updatedData.creatorCards,
            creatorScore: updatedData.creatorScore,
            opponentCards: updatedData.opponentCards,
            opponentScore: updatedData.opponentScore,
            payout: resolved.draw ? room.bet_amount : Math.ceil(room.bet_amount * 2 * (1 - HOUSE_EDGE)),
          });

          broadcastLobbyUpdate(io, 'blackjack');
          return ack?.({ bust: bust || newScore === 21, score: newScore });
        }

        updatedData.currentTurn = isCreator ? room.opponent_id : room.creator_id;

        await client.query(
          `UPDATE rooms
           SET game_data = $1::jsonb
           WHERE id = $2`,
          [JSON.stringify(updatedData), room.id]
        );

        await client.query('COMMIT');

        io.to(`room:${room.id}`).emit('blackjack:card_dealt', {
          roomId,
          playerId: user.id,
          card,
          hand: updatedCards,
          score: newScore,
          bust: false,
        });

        io.to(`room:${room.id}`).emit('blackjack:turn_switched', {
          roomId,
          currentTurn: isCreator ? room.opponent_id : room.creator_id,
        });

        ack?.({ card, hand: updatedCards, score: newScore });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[blackjack:hit]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to hit' });
    }
  });

  socket.on('blackjack:stand', async (payload, ack) => {
    try {
      const { roomId } = payload || {};

      if (!roomId) {
        return ack?.({ error: 'Room ID is required' });
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');

        const { rows: roomRows } = await client.query(
          `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
          [roomId]
        );

        if (roomRows.length === 0) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room not found' });
        }

        const room = roomRows[0];

        if (room.status !== 'IN_PROGRESS') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Game is not in progress' });
        }

        const gd = room.game_data || {};

        if (gd.currentTurn !== user.id) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Not your turn' });
        }

        const isCreator = user.id === room.creator_id;
        const playerKey = isCreator ? 'creator' : 'opponent';

        if (gd[`${playerKey}Status`] !== 'active') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'You cannot stand right now' });
        }

        const updatedData = {
          ...gd,
          [`${playerKey}Status`]: 'stood',
        };

        const otherKey = isCreator ? 'opponent' : 'creator';
        const otherStatus = updatedData[`${otherKey}Status`];

        if (otherStatus === 'stood' || otherStatus === 'bust') {
          const resolved = resolveGame(
            updatedData.creatorScore, updatedData.creatorStatus,
            updatedData.opponentScore, updatedData.opponentStatus,
            room.creator_id, room.opponent_id
          );

          if (resolved.draw) {
            await refund(room.creator_id, room.bet_amount, 'blackjack', room.id, client);
            await refund(room.opponent_id, room.bet_amount, 'blackjack', room.id, client);
          } else {
            await payout(resolved.winnerId, room.bet_amount * 2, 'blackjack', room.id, client, HOUSE_EDGE);
            const loserId = resolved.winnerId === room.creator_id ? room.opponent_id : room.creator_id;
            await distributeLossCommissions(client, { lossKey: `room:${room.id}:${loserId}`, sourceUserId: loserId, lossAmount: Number(room.bet_amount), gameType: 'blackjack' });
          }

            updatedData.winnerId = resolved.winnerId;
            updatedData.draw = resolved.draw;
            delete updatedData.deck;

            await client.query(
              `UPDATE rooms
               SET status = 'FINISHED',
                   winner_id = $1,
                   game_data = $2::jsonb
               WHERE id = $3`,
              [resolved.winnerId, JSON.stringify(updatedData), room.id]
            );

            await client.query('COMMIT');

            io.to(`room:${room.id}`).emit('blackjack:game_over', {
              roomId: room.id,
              winnerId: resolved.winnerId,
              draw: resolved.draw,
              creatorCards: updatedData.creatorCards,
              creatorScore: updatedData.creatorScore,
              opponentCards: updatedData.opponentCards,
              opponentScore: updatedData.opponentScore,
              payout: resolved.draw ? room.bet_amount : Math.ceil(room.bet_amount * 2 * (1 - HOUSE_EDGE)),
          });

          broadcastLobbyUpdate(io, 'blackjack');
          return ack?.({ stood: true, gameOver: true });
        }

        updatedData.currentTurn = isCreator ? room.opponent_id : room.creator_id;

        await client.query(
          `UPDATE rooms
           SET game_data = $1::jsonb
           WHERE id = $2`,
          [JSON.stringify(updatedData), room.id]
        );

        await client.query('COMMIT');

        io.to(`room:${room.id}`).emit('blackjack:turn_switched', {
          roomId,
          currentTurn: isCreator ? room.opponent_id : room.creator_id,
        });

        ack?.({ stood: true });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[blackjack:stand]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to stand' });
    }
  });
}
