import { describe, expect, it } from "vitest";
// @ts-expect-error -- pokersolver ships no types
import pokersolver from "pokersolver";

// Matches the exact import style used in handEval.ts (default import +
// destructure), which is what actually works identically under both Deno's
// npm CJS interop and Node/Vitest's -- see handEval.ts for why.
const { Hand } = pokersolver;

describe("pokersolver dependency", () => {
  it("resolves the bare 'pokersolver' import and solves a known hand", () => {
    const hand = Hand.solve(["Ah", "Kh", "Qh", "Jh", "Th", "2c", "3d"]);
    // pokersolver has no separate "Royal Flush" category -- it's the top-ranked Straight Flush.
    expect(hand.name).toBe("Straight Flush");
    expect(hand.descr).toBe("Royal Flush");
  });
});
