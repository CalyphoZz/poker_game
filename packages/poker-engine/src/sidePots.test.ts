import { describe, expect, it } from "vitest";
import { computeSidePots } from "./sidePots.ts";
import type { PlayerState } from "./types.ts";

function player(id: string, committedTotal: number, isFolded = false): PlayerState {
  return { id, stack: 0, committedTotal, committedThisStreet: 0, isFolded, isAllIn: false };
}

describe("computeSidePots", () => {
  it("returns a single pot when everyone committed the same amount", () => {
    const pots = computeSidePots([player("a", 100), player("b", 100), player("c", 100)]);
    expect(pots).toEqual([{ amount: 300, eligiblePlayerIds: ["a", "b", "c"] }]);
  });

  it("splits into main + side pot for one all-in for less", () => {
    // a is all-in for 50, b and c each put in 100.
    const pots = computeSidePots([player("a", 50), player("b", 100), player("c", 100)]);
    expect(pots).toEqual([
      { amount: 150, eligiblePlayerIds: ["a", "b", "c"] }, // 50 * 3
      { amount: 100, eligiblePlayerIds: ["b", "c"] }, // (100-50) * 2
    ]);
  });

  it("handles a triple all-in with three distinct levels", () => {
    const pots = computeSidePots([
      player("a", 20),
      player("b", 60),
      player("c", 100),
      player("d", 100),
    ]);
    expect(pots).toEqual([
      { amount: 80, eligiblePlayerIds: ["a", "b", "c", "d"] }, // 20 * 4
      { amount: 120, eligiblePlayerIds: ["b", "c", "d"] }, // 40 * 3
      { amount: 80, eligiblePlayerIds: ["c", "d"] }, // 40 * 2
    ]);
  });

  it("excludes folded players from eligibility but keeps their chips in the pot", () => {
    const pots = computeSidePots([player("a", 100, true), player("b", 100), player("c", 100)]);
    expect(pots).toEqual([{ amount: 300, eligiblePlayerIds: ["b", "c"] }]);
  });

  it("conserves total chips across all layers", () => {
    const players = [player("a", 20), player("b", 60), player("c", 100), player("d", 100)];
    const pots = computeSidePots(players);
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    const expected = players.reduce((sum, p) => sum + p.committedTotal, 0);
    expect(total).toBe(expected);
  });
});
