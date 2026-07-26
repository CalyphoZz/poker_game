import { describe, expect, it } from "vitest";
import { createDeck, shuffle } from "./deck.ts";

describe("createDeck", () => {
  it("has 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });
});

describe("shuffle", () => {
  it("preserves the same set of cards", () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, Math.random);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled)).toEqual(new Set(deck));
  });

  it("is deterministic given the same random source", () => {
    const deck = createDeck();
    let seed = 42;
    const seeded = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const a = shuffle(deck, seeded);
    seed = 42;
    const b = shuffle(deck, seeded);
    expect(a).toEqual(b);
  });

  it("does not mutate the input array", () => {
    const deck = createDeck();
    const copy = [...deck];
    shuffle(deck, Math.random);
    expect(deck).toEqual(copy);
  });
});
