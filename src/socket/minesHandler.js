import { getClient } from '../db/pool.js';
import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
import { createRoom } from '../services/roomService.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';
import {
  generateMinePositions,
  isValidCellIndex,
  isValidMinesCount,
  isMine,
  calculateMultiplier,
  TOTAL_CELLS,
  MIN_MINES, MAX_MINES,
  MIN_BET, MAX_BET,
} from '../games/mines.js';

export function registerMinesHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('mines:create_room', async (payload, ack) => {
    try {
      const { betAmount, minesCount } = payload || {};

      if (!betAmount || betAmount < MIN_BET) {
        return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      }
      if (betAmount > MAX_BET) {
        return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      }

      const count = minesCount ?? 3;
      if (!isValidMinesCount(count)) {
        return ack?.({ error: `Mines count must be between ${MIN_MINES} and ${MAX_MINES}` });
      }

      const room = await createRoom(user.id, 'mines', betAmount, {
        minesCount: count,
      });

      socket.join(`room:${room.id}`);

      ack?.({ roomId: room.id });

      broadcastLobbyUpdate(io, 'mines');
    } catch (err) {
      console.error('[mines:create_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to create mines room' });
    }
  });

  socket.on('mines:join_room', async (payload, ack) => {
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

        if (room.game_type !== 'mines') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is not a mines game' });
        }

        const minesCount = room.game_data?.minesCount;
        if (!minesCount || !isValidMinesCount(minesCount)) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is missing valid mines count' });
        }

        await holdBet(user.id, room.bet_amount, 'mines', room.id, client);

        const minePositions = generateMinePositions(minesCount);

        const gameData = {
          minesCount,
          minePositions,
          openedCells: [],
          safeOpenedCount: 0,
          currentTurn: room.creator_id,
          creatorSafeOpened: 0,
          opponentSafeOpened: 0,
          multiplier: 1,
        };

        await client.query(
          `UPDATE rooms
           SET status = 'IN_PROGRESS',
               opponent_id = $1,
               game_data = $2::jsonb
           WHERE id = $3`,
          [user.id, JSON.stringify(gameData), room.id]
        );

        await client.query('COMMIT');

        socket.join(`room:${room.id}`);

        ack?.({ roomId: room.id, currentTurn: room.creator_id });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[mines:join_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to join mines room' });
    }
  });

  socket.on('mines:click_cell', async (payload, ack) => {
    try {
      const { roomId, cellIndex } = payload || {};

      if (!roomId) {
        return ack?.({ error: 'Room ID is required' });
      }
      if (cellIndex === undefined || !isValidCellIndex(cellIndex)) {
        return ack?.({ error: `Cell index must be between 0 and ${TOTAL_CELLS - 1}` });
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

        const gameData = room.game_data || {};
        const { minePositions, openedCells, safeOpenedCount, currentTurn, minesCount } = gameData;

        if (currentTurn !== user.id) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Not your turn' });
        }

        if (openedCells.includes(cellIndex)) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Cell already opened' });
        }

        const pot = room.bet_amount * 2;
        const opponentId = room.creator_id === user.id ? room.opponent_id : room.creator_id;

        if (isMine(minePositions, cellIndex)) {
          const endData = {
            ...gameData,
            openedCells: [...openedCells, cellIndex],
          };

          await payout(opponentId, pot, 'mines', room.id, client, HOUSE_EDGE);

          await client.query(
            `UPDATE rooms
             SET status = 'FINISHED',
                 winner_id = $1,
                 game_data = $2::jsonb
             WHERE id = $3`,
            [opponentId, JSON.stringify(endData), room.id]
          );

          await client.query('COMMIT');

          io.to(`room:${room.id}`).emit('mines:game_over', {
            roomId: room.id,
            loserId: user.id,
            winnerId: opponentId,
            board: minePositions,
            lastCell: cellIndex,
            payout: pot,
          });

          broadcastLobbyUpdate(io, 'mines');
          return ack?.({ isMine: true, loserId: user.id, winnerId: opponentId });
        }

        const isCreator = user.id === room.creator_id;
        const newCreatorSafe = (isCreator ? gameData.creatorSafeOpened : gameData.opponentSafeOpened) + 1;
        const newOpponentSafe = isCreator ? gameData.opponentSafeOpened : gameData.creatorSafeOpened;
        const newOpenedCells = [...openedCells, cellIndex];
        const newSafeOpenedCount = safeOpenedCount + 1;
        const multiplier = calculateMultiplier(minesCount, newSafeOpenedCount);
        const nextTurn = opponentId;
        const totalSafeCells = TOTAL_CELLS - minesCount;
        const allSafeOpened = newSafeOpenedCount >= totalSafeCells;

        const updatedData = {
          ...gameData,
          openedCells: newOpenedCells,
          safeOpenedCount: newSafeOpenedCount,
          currentTurn: allSafeOpened ? null : nextTurn,
          multiplier,
          creatorSafeOpened: isCreator ? newCreatorSafe : newOpponentSafe,
          opponentSafeOpened: isCreator ? newOpponentSafe : newCreatorSafe,
        };

        if (allSafeOpened) {
          const creatorWon = newCreatorSafe > newOpponentSafe;
          const opponentWon = newOpponentSafe > newCreatorSafe;
          const winnerId = creatorWon ? room.creator_id : opponentWon ? room.opponent_id : null;

          if (winnerId) {
            await payout(winnerId, pot, 'mines', room.id, client, HOUSE_EDGE);
          }

          await client.query(
            `UPDATE rooms
             SET status = 'FINISHED',
                 winner_id = $1,
                 game_data = $2::jsonb
             WHERE id = $3`,
            [winnerId, JSON.stringify(updatedData), room.id]
          );

          await client.query('COMMIT');

          io.to(`room:${room.id}`).emit('mines:game_over', {
            roomId: room.id,
            winnerId,
            loserId: winnerId ? (winnerId === room.creator_id ? room.opponent_id : room.creator_id) : null,
            board: minePositions,
            allSafeOpened: true,
            creatorSafeOpened: newCreatorSafe,
            opponentSafeOpened: newOpponentSafe,
            payout: pot,
            isDraw: !winnerId,
          });

          broadcastLobbyUpdate(io, 'mines');
          return ack?.({ isMine: false, allSafeOpened: true, winnerId, isDraw: !winnerId });
        }

        await client.query(
          `UPDATE rooms
           SET game_data = $1::jsonb
           WHERE id = $2`,
          [JSON.stringify(updatedData), room.id]
        );

        await client.query('COMMIT');

        io.to(`room:${room.id}`).emit('mines:cell_opened', {
          roomId: room.id,
          cellIndex,
          isMine: false,
          nextTurn,
          multiplier,
          safeOpenedCount: newSafeOpenedCount,
        });

        ack?.({ isMine: false, nextTurn, multiplier });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[mines:click_cell]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to process cell click' });
    }
  });
}
