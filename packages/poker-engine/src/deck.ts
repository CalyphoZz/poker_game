import type { Card } from "./types.ts";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["s", "h", "d", "c"];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

// Random source is injected so tests can supply a seeded PRNG for
// deterministic hands; production wires in a real CSPRNG at the Edge
// Function boundary. Fisher-Yates, in place on a copy of the input.
export function shuffle(deck: Card[], randomSource: () => number = Math.random): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomSource() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
