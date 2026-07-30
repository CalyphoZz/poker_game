import { describe, expect, it } from "vitest";
import { applyAction } from "./betting.ts";
import { decideBotAction } from "./bot.ts";
import { createDeck, shuffle } from "./deck.ts";
import type { HandState, PlayerState } from "./types.ts";

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    stack: 1000,
    committedTotal: 0,
    committedThisStreet: 0,
    isFolded: false,
    isAllIn: false,
    ...overrides,
  };
}

// Keeps committedTotal in sync with committedThisStreet, exactly like the
// real engine always does -- a fixture that set only one would silently
// break the pot-odds math (pot is derived from committedTotal).
function committed(amount: number) {
  return { committedThisStreet: amount, committedTotal: amount };
}

function baseState(overrides: Partial<HandState> = {}): HandState {
  return {
    players: [player("bot"), player("villain")],
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    street: "river",
    board: ["2c", "7d", "9c", "Jd", "3s"],
    deck: [],
    holeCards: { bot: ["2h", "4h"], villain: ["Ah", "Ad"] },
    currentBet: 0,
    minRaise: 20,
    actingIndex: 0,
    lastAggressorIndex: null,
    actionsRemainingThisStreet: 1,
    smallBlind: 10,
    bigBlind: 20,
    status: "in_progress",
    ...overrides,
  };
}

// A random source that never triggers "mistake" or "bonus raise" branches,
// so hard/medium bots make their base strength-driven decision every time.
const noRandomness = () => 0.999;

// A tiny deterministic LCG -- unlike a constant function, successive calls
// within the same decideBotAction invocation actually advance, so the
// mistake-roll, strength check, and raise-chance roll each see independent
// values (matching how Math.random would behave in production).
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("decideBotAction", () => {
  it("checks for free with a weak hand instead of betting", () => {
    const state = baseState({ currentBet: 0 });
    const decision = decideBotAction(state, "hard", noRandomness);
    expect(decision.type).toBe("check");
  });

  it("hard bot folds a weak hand facing a large bet", () => {
    const state = baseState({
      currentBet: 500,
      players: [player("bot"), player("villain", committed(500))],
    });
    const decision = decideBotAction(state, "hard", noRandomness);
    expect(decision.type).toBe("fold");
  });

  it("hard bot continues with a strong hand facing a bet", () => {
    // bot holds a set of nines on this board -- a clearly strong hand.
    const state = baseState({
      holeCards: { bot: ["9h", "9s"], villain: ["Ah", "Ad"] },
      currentBet: 40,
      players: [player("bot"), player("villain", committed(40))],
    });
    const decision = decideBotAction(state, "hard", noRandomness);
    expect(["call", "raise"]).toContain(decision.type);
  });

  it("never raises above the player's own stack", () => {
    const state = baseState({
      holeCards: { bot: ["9h", "9s"], villain: ["Ah", "Ad"] },
      currentBet: 20,
      minRaise: 20,
      players: [player("bot", { stack: 25 }), player("villain", committed(20))],
    });
    // Force the raise branch deterministically to check bounds even when it fires.
    const forceRaise = () => 0;
    const decision = decideBotAction(state, "hard", forceRaise);
    if (decision.type === "raise") {
      expect(decision.amount!).toBeLessThanOrEqual(25 + 20);
    }
  });

  it("easy bot's mistake branch always returns a structurally valid decision", () => {
    const state = baseState({
      currentBet: 40,
      players: [player("bot"), player("villain", committed(40))],
    });
    const decision = decideBotAction(state, "easy", seededRandom(1));
    expect(["fold", "check", "call", "raise"]).toContain(decision.type);
  });

  it("easy bots misplay far more often than hard bots over many trials", () => {
    // Weak hand facing a pot-sized bet -- the "book" play is fold. Sweep many
    // seeds per difficulty and compare how often each deviates from that.
    const state = baseState({
      currentBet: 500,
      players: [player("bot"), player("villain", committed(500))],
    });

    function nonFoldRate(difficulty: "easy" | "hard") {
      let nonFolds = 0;
      const trials = 300;
      for (let seed = 0; seed < trials; seed++) {
        if (decideBotAction(state, difficulty, seededRandom(seed)).type !== "fold") nonFolds++;
      }
      return nonFolds / trials;
    }

    expect(nonFoldRate("easy")).toBeGreaterThan(nonFoldRate("hard"));
  });

  it("every decision it makes is accepted by applyAction, across many random deals", () => {
    // Structural validity (fold/check/call/raise + sane amount) isn't the
    // same as the engine actually accepting it -- run decisions through the
    // real reducer across many random deals/streets/stack depths and
    // confirm applyAction never throws.
    const difficulties: Array<"easy" | "medium" | "hard"> = ["easy", "medium", "hard"];

    for (let trial = 0; trial < 100; trial++) {
      const rng = seededRandom(trial * 7 + 1);
      const deck = shuffle(createDeck(), rng);
      const stackA = 20 + Math.floor(rng() * 500);
      const stackB = 20 + Math.floor(rng() * 500);
      const currentBet = Math.floor(rng() * 60);
      const committedA = Math.floor(rng() * Math.min(currentBet, stackA));
      const street = (["preflop", "flop", "turn", "river"] as const)[Math.floor(rng() * 4)];
      const board = street === "preflop" ? [] : deck.slice(0, street === "flop" ? 3 : street === "turn" ? 4 : 5);

      const state: HandState = {
        players: [
          player("bot", { stack: stackA, ...committed(committedA) }),
          player("villain", { stack: stackB, ...committed(currentBet) }),
        ],
        dealerIndex: 0,
        smallBlindIndex: 0,
        bigBlindIndex: 1,
        street,
        board,
        deck: deck.slice(5),
        holeCards: { bot: [deck[5], deck[6]], villain: [deck[7], deck[8]] },
        currentBet,
        minRaise: 20,
        actingIndex: 0,
        lastAggressorIndex: null,
        actionsRemainingThisStreet: 1,
        smallBlind: 10,
        bigBlind: 20,
        status: "in_progress",
      };

      const difficulty = difficulties[trial % 3];
      const decision = decideBotAction(state, difficulty, rng);
      expect(() =>
        applyAction(state, { type: decision.type, playerId: "bot", amount: decision.amount }),
      ).not.toThrow();
    }
  });
});
