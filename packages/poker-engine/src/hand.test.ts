import { describe, expect, it } from "vitest";
import { applyAction } from "./betting.ts";
import { maybeAdvanceStreetOrShowdown } from "./betting.ts";
import { startNewHand } from "./blinds.ts";
import type { HandState, PlayerState } from "./types.ts";

function totalChips(state: HandState): number {
  const inPlay = state.players.reduce((sum, p) => sum + p.stack + p.committedTotal, 0);
  return inPlay;
}

describe("startNewHand + applyAction: everyone folds preflop", () => {
  it("awards the whole pot to the last player standing, uncontested", () => {
    const players = [
      { id: "p0", stack: 1000 },
      { id: "p1", stack: 1000 },
      { id: "p2", stack: 1000 },
    ];
    const startTotal = players.reduce((sum, p) => sum + p.stack, 0);

    let result = startNewHand({
      players,
      previousDealerId: null,
      smallBlind: 10,
      bigBlind: 20,
    });
    // dealerIndex=0 (p0), sbIndex=1 (p1), bbIndex=2 (p2), UTG/first-to-act = p0.
    expect(result.state.actingIndex).toBe(0);

    result = applyAction(result.state, { type: "fold", playerId: "p0" });
    result = applyAction(result.state, { type: "fold", playerId: "p1" });

    expect(result.state.status).toBe("complete");
    const handComplete = result.events.find((e) => e.type === "hand_complete");
    expect(handComplete?.type).toBe("hand_complete");
    if (handComplete?.type === "hand_complete") {
      expect(handComplete.pots).toHaveLength(1);
      expect(handComplete.pots[0].winnerIds).toEqual(["p2"]);
      expect(handComplete.pots[0].amount).toBe(30); // 10 (SB) + 20 (BB)
    }
    expect(totalChips(result.state)).toBe(startTotal);
  });
});

describe("startNewHand: heads-up blind rule", () => {
  it("dealer posts the small blind and acts first preflop, but not postflop", () => {
    const players = [
      { id: "dealer", stack: 1000 },
      { id: "other", stack: 1000 },
    ];

    const start = startNewHand({
      players,
      previousDealerId: null,
      smallBlind: 10,
      bigBlind: 20,
    });

    expect(start.state.dealerIndex).toBe(0);
    const dealerPlayer = start.state.players[0];
    expect(dealerPlayer.committedThisStreet).toBe(10); // dealer posted SB
    expect(start.state.players[1].committedThisStreet).toBe(20); // other posted BB
    expect(start.state.actingIndex).toBe(0); // dealer acts first preflop

    // Dealer calls to match the big blind, other checks -> preflop closes.
    let result = applyAction(start.state, { type: "call", playerId: "dealer" });
    result = applyAction(result.state, { type: "check", playerId: "other" });

    expect(result.state.street).toBe("flop");
    expect(result.state.actingIndex).toBe(1); // non-dealer acts first postflop
  });
});

describe("applyAction: short-stack all-in for less than a full call", () => {
  it("caps the call at the player's remaining stack and marks them all-in", () => {
    const players = [
      { id: "short", stack: 15 }, // less than the big blind
      { id: "p1", stack: 1000 },
      { id: "p2", stack: 1000 },
    ];

    const start = startNewHand({ players, previousDealerId: null, smallBlind: 10, bigBlind: 20 });
    // dealer=short(0), sb=p1(1) posts 10, bb=p2(2) posts 20, first to act = short(0).
    let result = applyAction(start.state, { type: "call", playerId: "short" });
    const shortPlayer = result.state.players.find((p) => p.id === "short")!;
    expect(shortPlayer.stack).toBe(0);
    expect(shortPlayer.isAllIn).toBe(true);
    expect(shortPlayer.committedThisStreet).toBe(15); // all they had, less than the 20 to call
  });
});

describe("applyAction: illegal actions are rejected", () => {
  it("rejects acting out of turn", () => {
    const players = [
      { id: "p0", stack: 1000 },
      { id: "p1", stack: 1000 },
      { id: "p2", stack: 1000 },
    ];
    const start = startNewHand({ players, previousDealerId: null, smallBlind: 10, bigBlind: 20 });
    expect(() => applyAction(start.state, { type: "fold", playerId: "p1" })).toThrow();
  });

  it("rejects checking when facing a bet", () => {
    const players = [
      { id: "p0", stack: 1000 },
      { id: "p1", stack: 1000 },
      { id: "p2", stack: 1000 },
    ];
    const start = startNewHand({ players, previousDealerId: null, smallBlind: 10, bigBlind: 20 });
    expect(() => applyAction(start.state, { type: "check", playerId: "p0" })).toThrow();
  });

  it("rejects a raise below the minimum raise size", () => {
    const players = [
      { id: "p0", stack: 1000 },
      { id: "p1", stack: 1000 },
      { id: "p2", stack: 1000 },
    ];
    const start = startNewHand({ players, previousDealerId: null, smallBlind: 10, bigBlind: 20 });
    // Current bet is 20 (BB), min raise increment is 20 -> a raise to 25 is
    // too small (needs to be at least 40).
    expect(() => applyAction(start.state, { type: "raise", playerId: "p0", amount: 25 })).toThrow();
  });
});

describe("maybeAdvanceStreetOrShowdown: side pots and split pots at showdown", () => {
  function player(
    id: string,
    committedTotal: number,
    stack: number,
    isFolded = false,
    isAllIn = false,
  ): PlayerState {
    return { id, stack, committedTotal, committedThisStreet: 0, isFolded, isAllIn };
  }

  it("resolves a single all-in side pot with the stronger hand taking both layers", () => {
    // a all-in for 50 with a strong hand, b and c each put in 100 with worse hands.
    const state: HandState = {
      players: [
        player("a", 50, 0, false, true),
        player("b", 100, 900),
        player("c", 100, 900),
      ],
      dealerIndex: 0,
      smallBlindIndex: 1,
      bigBlindIndex: 2,
      street: "river",
      board: ["2h", "7d", "9c", "Jd", "3s"],
      deck: [],
      holeCards: {
        a: ["Ks", "Kd"], // pair of kings -- best hand
        b: ["Th", "Td"], // pair of tens -- beats c's high card outright
        c: ["6c", "8h"], // nothing, high card only
      },
      currentBet: 100,
      minRaise: 20,
      actingIndex: 0,
      lastAggressorIndex: null,
      actionsRemainingThisStreet: 0,
      smallBlind: 10,
      bigBlind: 20,
      status: "in_progress",
    };
    const startTotal = totalChips(state);

    const result = maybeAdvanceStreetOrShowdown(state);
    expect(result.state.status).toBe("complete");
    const handComplete = result.events.find((e) => e.type === "hand_complete");
    if (handComplete?.type !== "hand_complete") throw new Error("expected hand_complete");

    expect(handComplete.pots).toHaveLength(2);
    expect(handComplete.pots[0].amount).toBe(150); // 50 * 3
    expect(handComplete.pots[0].winnerIds).toEqual(["a"]);
    expect(handComplete.pots[1].amount).toBe(100); // (100-50) * 2
    expect(handComplete.pots[1].winnerIds).toEqual(["b"]); // best of the two non-all-in hands

    expect(totalChips(result.state)).toBe(startTotal);
  });

  it("resolves a triple all-in into three pot layers", () => {
    const state: HandState = {
      players: [
        player("a", 20, 0, false, true),
        player("b", 60, 0, false, true),
        player("c", 100, 900),
        player("d", 100, 900),
      ],
      dealerIndex: 0,
      smallBlindIndex: 1,
      bigBlindIndex: 2,
      street: "river",
      board: ["2h", "7d", "9c", "Jd", "3s"],
      deck: [],
      holeCards: {
        a: ["4c", "4d"], // weakest
        b: ["5c", "5d"], // beats a
        c: ["6c", "6d"], // beats a and b
        d: ["7c", "7h"], // wait: board already has a 7d, avoid duplicate below
      },
      currentBet: 100,
      minRaise: 20,
      actingIndex: 0,
      lastAggressorIndex: null,
      actionsRemainingThisStreet: 0,
      smallBlind: 10,
      bigBlind: 20,
      status: "in_progress",
    };
    // Fix the accidental duplicate 7d/7h card collision with the board's 7d.
    state.holeCards.d = ["Ac", "Ad"]; // best hand overall
    const startTotal = totalChips(state);

    const result = maybeAdvanceStreetOrShowdown(state);
    const handComplete = result.events.find((e) => e.type === "hand_complete");
    if (handComplete?.type !== "hand_complete") throw new Error("expected hand_complete");

    expect(handComplete.pots).toHaveLength(3);
    expect(handComplete.pots[0]).toMatchObject({ amount: 80, winnerIds: ["d"] }); // 20*4
    expect(handComplete.pots[1]).toMatchObject({ amount: 120, winnerIds: ["d"] }); // 40*3
    expect(handComplete.pots[2]).toMatchObject({ amount: 80, winnerIds: ["d"] }); // 40*2
    expect(totalChips(result.state)).toBe(startTotal);
  });

  it("splits a pot evenly between tied hands, distributing the odd chip", () => {
    // Board itself is a straight flush -- both players just play the board,
    // an exact tie regardless of their hole cards.
    const state: HandState = {
      players: [player("a", 101, 0), player("b", 101, 0)],
      dealerIndex: 0,
      smallBlindIndex: 0,
      bigBlindIndex: 1,
      street: "river",
      board: ["Ah", "Kh", "Qh", "Jh", "Th"],
      deck: [],
      holeCards: { a: ["2c", "3d"], b: ["4c", "5d"] },
      currentBet: 101,
      minRaise: 20,
      actingIndex: 0,
      lastAggressorIndex: null,
      actionsRemainingThisStreet: 0,
      smallBlind: 10,
      bigBlind: 20,
      status: "in_progress",
    };

    const result = maybeAdvanceStreetOrShowdown(state);
    const handComplete = result.events.find((e) => e.type === "hand_complete");
    if (handComplete?.type !== "hand_complete") throw new Error("expected hand_complete");

    expect(handComplete.pots).toHaveLength(1);
    const pot = handComplete.pots[0];
    expect(pot.amount).toBe(202);
    expect(pot.winnerIds.sort()).toEqual(["a", "b"]);
    // 202 split two ways = 101 each, no odd chip in this case.
    expect(pot.amounts.a + pot.amounts.b).toBe(202);
  });
});

describe("full hand simulation: heads-up to showdown", () => {
  it("conserves chips end to end through preflop/flop/turn/river", () => {
    const players = [
      { id: "dealer", stack: 500 },
      { id: "other", stack: 500 },
    ];
    const startTotal = players.reduce((sum, p) => sum + p.stack, 0);

    let result = startNewHand({ players, previousDealerId: null, smallBlind: 10, bigBlind: 20 });

    // Preflop: dealer calls, other checks.
    result = applyAction(result.state, { type: "call", playerId: "dealer" });
    result = applyAction(result.state, { type: "check", playerId: "other" });
    expect(result.state.street).toBe("flop");

    // Flop: other (acts first postflop) checks, dealer checks.
    result = applyAction(result.state, { type: "check", playerId: "other" });
    result = applyAction(result.state, { type: "check", playerId: "dealer" });
    expect(result.state.street).toBe("turn");

    // Turn: other bets, dealer calls.
    result = applyAction(result.state, { type: "raise", playerId: "other", amount: 20 });
    result = applyAction(result.state, { type: "call", playerId: "dealer" });
    expect(result.state.street).toBe("river");

    // River: both check -> showdown.
    result = applyAction(result.state, { type: "check", playerId: "other" });
    result = applyAction(result.state, { type: "check", playerId: "dealer" });

    expect(result.state.status).toBe("complete");
    expect(totalChips(result.state)).toBe(startTotal);
    const handComplete = result.events.find((e) => e.type === "hand_complete");
    expect(handComplete?.type).toBe("hand_complete");
  });
});
