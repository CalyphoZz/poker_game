// pokersolver is CommonJS with no type declarations. Deno's npm CJS interop
// only exposes a default export (the whole `module.exports`), unlike Node/
// esbuild's interop which also synthesizes named exports -- importing the
// default and destructuring works identically in both runtimes.
// @ts-expect-error -- no type declarations
import pokersolver from "pokersolver";
import type { Card } from "./types.ts";

const { Hand: PokersolverHand } = pokersolver;

export interface EvaluatedHand {
  name: string;
  descr: string;
  raw: unknown; // underlying pokersolver Hand instance, needed by winningIndices()
}

// pokersolver requires at least 5 cards, so this can only be called from the
// flop onward (2 hole + >=3 board) -- matching the UX requirement that the
// "current best hand" indicator only appears once the flop is dealt.
export function evaluateHand(holeCards: [Card, Card], board: Card[]): EvaluatedHand {
  const raw = PokersolverHand.solve([...holeCards, ...board]);
  return { name: raw.name, descr: raw.descr, raw };
}

// Indices (into `hands`) of the winning hand(s) -- more than one index means
// a split pot. Delegates tie-breaking entirely to pokersolver rather than
// re-implementing kicker comparisons.
export function winningIndices(hands: EvaluatedHand[]): number[] {
  const winners: unknown[] = PokersolverHand.winners(hands.map((h) => h.raw));
  const winnerSet = new Set(winners);
  const indices: number[] = [];
  hands.forEach((hand, index) => {
    if (winnerSet.has(hand.raw)) indices.push(index);
  });
  return indices;
}
