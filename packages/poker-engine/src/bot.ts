import { evaluateHand } from "./handEval.ts";
import type { Card, HandState, PlayerActionType } from "./types.ts";

export type BotDifficulty = "easy" | "medium" | "hard";

export interface BotDecision {
  type: PlayerActionType;
  amount?: number;
}

const RANK_ORDER = "23456789TJQKA";

// Postflop uses pokersolver's own category rank (1 High Card .. 9 Straight
// Flush), reusing the same evaluator the client uses for the "current best
// hand" indicator -- but mapped through a deliberately non-linear curve
// rather than a plain (rank-1)/8. A linear mapping puts Three of a Kind at
// 0.375, which reads as "fold to aggression" -- wrong, a set is a hand you
// rarely fold. Made hands (trips or better) need to land solidly above the
// fold thresholds below; only High Card/Pair should look genuinely weak.
const POSTFLOP_STRENGTH: Record<number, number> = {
  1: 0.1, // High Card
  2: 0.32, // Pair
  3: 0.52, // Two Pair
  4: 0.72, // Three of a Kind
  5: 0.82, // Straight
  6: 0.87, // Flush
  7: 0.93, // Full House
  8: 0.97, // Four of a Kind
  9: 1.0, // Straight Flush
};

// Preflop (no board yet) falls back to a simple high-card/pair/suited
// heuristic since pokersolver needs at least 5 cards.
function handStrength(holeCards: [Card, Card], board: Card[]): number {
  if (board.length >= 3) {
    const evaluated = evaluateHand(holeCards, board);
    const rank = (evaluated.raw as { rank: number }).rank;
    return POSTFLOP_STRENGTH[rank] ?? 0.1;
  }

  const r1 = RANK_ORDER.indexOf(holeCards[0][0]);
  const r2 = RANK_ORDER.indexOf(holeCards[1][0]);
  const suited = holeCards[0][1] === holeCards[1][1];
  const isPair = holeCards[0][0] === holeCards[1][0];
  const connected = Math.abs(r1 - r2) === 1;

  let score = (r1 + r2) / (2 * (RANK_ORDER.length - 1));
  if (isPair) score += 0.35;
  if (suited) score += 0.05;
  if (connected) score += 0.03;
  return Math.min(1, score);
}

// Tuned so difficulty reads clearly at the table: easy genuinely misplays
// hands (a real mistake chance, not just "a bit looser"), hard plays close
// to textbook pot-odds/hand-strength poker with almost no randomness.
const PROFILES: Record<
  BotDifficulty,
  { mistakeChance: number; foldBar: number; raiseBar: number; raiseChance: number }
> = {
  easy: { mistakeChance: 0.3, foldBar: 0.15, raiseBar: 0.85, raiseChance: 0.12 },
  medium: { mistakeChance: 0.12, foldBar: 0.3, raiseBar: 0.72, raiseChance: 0.22 },
  hard: { mistakeChance: 0.03, foldBar: 0.38, raiseBar: 0.62, raiseChance: 0.3 },
};

function randomLegalMistake(
  canCheck: boolean,
  minRaiseTarget: number,
  maxRaiseTarget: number,
  randomSource: () => number,
): BotDecision {
  const roll = randomSource();
  if (roll < 0.4) return { type: "fold" };
  if (canCheck) return { type: "check" };
  if (roll < 0.85 || minRaiseTarget > maxRaiseTarget) return { type: "call" };
  return { type: "raise", amount: minRaiseTarget };
}

export function decideBotAction(
  state: HandState,
  difficulty: BotDifficulty,
  randomSource: () => number = Math.random,
): BotDecision {
  const actor = state.players[state.actingIndex];
  const holeCards = state.holeCards[actor.id];
  const toCall = state.currentBet - actor.committedThisStreet;
  const canCheck = toCall <= 0;
  const minRaiseTarget = state.currentBet + state.minRaise;
  const maxRaiseTarget = actor.stack + actor.committedThisStreet;
  const profile = PROFILES[difficulty];

  if (randomSource() < profile.mistakeChance) {
    return randomLegalMistake(canCheck, minRaiseTarget, maxRaiseTarget, randomSource);
  }

  const strength = handStrength(holeCards, state.board);
  const pot = state.players.reduce((sum, p) => sum + p.committedTotal, 0);

  function raiseTarget(potFraction: number): number {
    return Math.min(maxRaiseTarget, Math.round(state.currentBet + Math.max(state.minRaise, pot * potFraction)));
  }

  if (canCheck) {
    if (strength > profile.raiseBar && randomSource() < profile.raiseChance + (strength - profile.raiseBar)) {
      const target = raiseTarget(0.6);
      if (target > state.currentBet) return { type: "raise", amount: target };
    }
    return { type: "check" };
  }

  const potOdds = toCall / (pot + toCall);

  // All-in for the rest of their stack: only worth it with a real hand.
  if (toCall >= actor.stack && strength < 0.5) {
    return { type: "fold" };
  }

  if (strength < profile.foldBar && potOdds > strength) {
    return { type: "fold" };
  }

  if (strength > profile.raiseBar && randomSource() < profile.raiseChance) {
    const target = raiseTarget(0.75);
    if (target > state.currentBet && target - actor.committedThisStreet <= actor.stack) {
      return { type: "raise", amount: target };
    }
  }

  return { type: "call" };
}
