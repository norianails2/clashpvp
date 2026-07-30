// ================================================================
//  BLACKJACK ENGINE – Core game logic
// ================================================================

const SUITS = ['h', 'd', 'c', 's']; // hearts, diamonds, clubs, spades
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUIT_SYMBOLS = { h: '♥', d: '♦', c: '♣', s: '♠' };

// ---- DECK ----

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, symbol: SUIT_SYMBOLS[suit], value: cardValue(rank) });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11; // Ace as 11 initially
  return parseInt(rank, 10);
}

// ---- HAND SCORE ----

function calculateHandScore(cards) {
  let score = 0;
  let aces = 0;
  for (const card of cards) {
    if (!card) continue;
    const val = card.rank === 'A' ? 11 : (['J','Q','K'].includes(card.rank) ? 10 : parseInt(card.rank, 10));
    if (card.rank === 'A') aces++;
    score += val;
  }
  // Adjust aces from 11 to 1 if over 21
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

function isBust(score) { return score > 21; }
function isBlackjack(cards) { return cards.length === 2 && calculateHandScore(cards) === 21; }
function isSoft(cards) {
  let score = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') aces++;
    score += c.rank === 'A' ? 11 : (['J','Q','K'].includes(c.rank) ? 10 : parseInt(c.rank, 10));
  }
  return score <= 21 && aces > 0 && score - (aces - 1) * 10 <= 21;
}

// ---- DEALER ----

function shouldDealerHit(hand) {
  const score = calculateHandScore(hand);
  if (score < 17) return true;
  if (score === 17 && isSoft(hand)) return true; // hit on soft 17
  return false;
}

// ---- RESOLVE ----

/**
 * Resolves the outcome of a blackjack hand.
 * @returns {{ winner: 'player'|'dealer'|'push', blackjack: boolean, playerScore: number, dealerScore: number }}
 */
function resolveHand(playerCards, dealerCards) {
  const playerScore = calculateHandScore(playerCards);
  const dealerScore = calculateHandScore(dealerCards);
  const playerBust = isBust(playerScore);
  const dealerBust = isBust(dealerScore);
  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBust) return { winner: 'dealer', playerScore, dealerScore, reason: 'bust' };
  if (dealerBust) return { winner: 'player', playerScore, dealerScore, reason: 'dealer_bust' };
  if (playerBJ && dealerBJ) return { winner: 'push', playerScore, dealerScore, blackjack: true };
  if (playerBJ) return { winner: 'player', playerScore, dealerScore, blackjack: true };
  if (dealerBJ) return { winner: 'dealer', playerScore, dealerScore, blackjack: true };
  if (playerScore > dealerScore) return { winner: 'player', playerScore, dealerScore };
  if (dealerScore > playerScore) return { winner: 'dealer', playerScore, dealerScore };
  return { winner: 'push', playerScore, dealerScore };
}

/**
 * PvP: Both players play against the dealer independently.
 * Returns winner for each player vs dealer: 'player_1_wins', 'player_2_wins', 'both_win', 'both_lose', 'push'
 */
function resolvePvP(player1Cards, player2Cards, dealerCards) {
  const r1 = resolveHand(player1Cards, dealerCards);
  const r2 = resolveHand(player2Cards, dealerCards);

  const p1win = r1.winner === 'player' || (r1.winner === 'push' && r1.blackjack === false);
  const p2win = r2.winner === 'player' || (r2.winner === 'push' && r2.blackjack === false);
  const p1lose = r1.winner === 'dealer';
  const p2lose = r2.winner === 'dealer';

  return {
    player1Result: r1,
    player2Result: r2,
    // Winner of the pot (who has higher score without busting)
    potWinner: p1win && p2win
      ? (r1.playerScore > r2.playerScore ? 'player1' : r2.playerScore > r1.playerScore ? 'player2' : 'split')
      : p1win ? 'player1'
      : p2win ? 'player2'
      : 'dealer',
    player1Wins: p1win,
    player2Wins: p2win,
  };
}

// ---- Payout ----
// Blackjack pays 3:2, standard win pays 1:1
function calculatePayout(bet, result) {
  if (result.winner === 'push') return bet; // refund
  if (result.blackjack && result.winner === 'player') return Math.floor(bet * 2.5); // 3:2
  if (result.winner === 'player') return bet * 2; // 1:1
  return 0; // lose
}

module.exports = {
  createDeck,
  shuffleDeck,
  calculateHandScore,
  isBust,
  isBlackjack,
  shouldDealerHit,
  resolveHand,
  resolvePvP,
  calculatePayout,
  SUIT_SYMBOLS,
  RANKS,
  cardValue,
};
