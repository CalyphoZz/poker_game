import type { PlayerState, SidePot } from "./types.ts";

// Splits total contributions into pot layers whenever players are committed
// for different amounts (one or more all-ins for less than a full call).
// Folded players still contributed their chips to whichever layer their
// commitment falls into, but are never eligible to win.
//
// Standard algorithm: sort distinct commitment levels ascending; each layer
// between two consecutive levels is funded by everyone who committed at
// least the higher level, and is only contestable by the non-folded players
// among them.
export function computeSidePots(players: PlayerState[]): SidePot[] {
  const contributors = players.filter((p) => p.committedTotal > 0);
  const levels = Array.from(new Set(contributors.map((p) => p.committedTotal))).sort(
    (a, b) => a - b,
  );

  const pots: SidePot[] = [];
  let previousLevel = 0;
  for (const level of levels) {
    const layerContributors = contributors.filter((p) => p.committedTotal >= level);
    const amount = (level - previousLevel) * layerContributors.length;
    const eligiblePlayerIds = layerContributors.filter((p) => !p.isFolded).map((p) => p.id);

    if (amount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({ amount, eligiblePlayerIds });
    }
    previousLevel = level;
  }
  return pots;
}
