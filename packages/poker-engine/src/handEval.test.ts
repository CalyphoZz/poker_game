import { describe, expect, it } from "vitest";
import { evaluateHand, winningIndices } from "./handEval.ts";

describe("evaluateHand", () => {
  it("recognizes a straight flush (the board plays as a royal)", () => {
    const hand = evaluateHand(["2c", "3d"], ["Ah", "Kh", "Qh", "Jh", "Th"]);
    expect(hand.name).toBe("Straight Flush");
  });

  it("recognizes a pair from the hole cards", () => {
    const hand = evaluateHand(["Ks", "Kd"], ["2c", "7d", "9h", "Jc", "3s"]);
    expect(hand.name).toBe("Pair");
  });
});

describe("winningIndices", () => {
  it("picks the single best hand", () => {
    const board = ["2c", "7d", "9h", "Jc", "3s"];
    const hands = [
      evaluateHand(["Ks", "Kd"], board), // pair of kings
      evaluateHand(["4h", "5h"], board), // ace high, nothing
    ];
    expect(winningIndices(hands)).toEqual([0]);
  });

  it("returns every tied hand for a split pot", () => {
    // Board is a straight flush on its own -- both hole-card pairs are
    // irrelevant kickers, so both players play the same 5-card board hand.
    const board = ["Ah", "Kh", "Qh", "Jh", "Th"];
    const hands = [
      evaluateHand(["2c", "3d"], board),
      evaluateHand(["4c", "5d"], board),
    ];
    const winners = winningIndices(hands);
    expect(winners.sort()).toEqual([0, 1]);
  });
});
