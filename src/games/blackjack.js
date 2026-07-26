import crypto from 'crypto';

const SUITS = ['h', 'd', 'c', 's'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

const MIN_BET = 1;
const MAX_BET = 100000;

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getCardValue(card) {
  const rank = card.slice(0, -1);
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank, 10);
}

export function calculateScore(cards) {
  let score = 0;
  let aces = 0;

  for (const card of cards) {
    const value = getCardValue(card);
    score += value;
    if (card.slice(0, -1) === 'A') aces++;
  }

  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }

  return score;
}

export function dealCards(deck, count = 1) {
  const dealt = [];
  const remaining = [...deck];
  for (let i = 0; i < count; i++) {
    if (remaining.length === 0) break;
    dealt.push(remaining.shift());
  }
  return { cards: dealt, deck: remaining };
}

export function isBlackjack(cards) {
  return cards.length === 2 && calculateScore(cards) === 21;
}

export function isBust(score) {
  return score > 21;
}

export function resolveGame(creatorScore, creatorStatus, opponentScore, opponentStatus, creatorId, opponentId) {
  const creatorBust = creatorStatus === 'bust';
  const opponentBust = opponentStatus === 'bust';

  if (creatorBust && opponentBust) {
    return { winnerId: null, draw: true };
  }
  if (creatorBust) {
    return { winnerId: opponentId, draw: false };
  }
  if (opponentBust) {
    return { winnerId: creatorId, draw: false };
  }
  if (creatorScore > opponentScore) {
    return { winnerId: creatorId, draw: false };
  }
  if (opponentScore > creatorScore) {
    return { winnerId: opponentId, draw: false };
  }
  return { winnerId: null, draw: true };
}

export { MIN_BET, MAX_BET };
