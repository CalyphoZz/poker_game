import { evaluateHand, winningIndices } from "./handEval.ts";
import { computeSidePots } from "./sidePots.ts";
import type {
  Action,
  ActionType,
  ApplyActionResult,
  Card,
  EngineEvent,
  HandState,
  PlayerState,
  PotResult,
  Street,
} from "./types.ts";

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river"];

function canAct(p: PlayerState): boolean {
  return !p.isFolded && !p.isAllIn;
}

function playersWhoCanAct(state: HandState): PlayerState[] {
  return state.players.filter(canAct);
}

function nonFoldedPlayers(state: HandState): PlayerState[] {
  return state.players.filter((p) => !p.isFolded);
}

// Finds the next index (wrapping) starting *after* `fromIndex` whose player
// satisfies `predicate`. Returns null if no such player exists.
function findNextIndex(
  state: HandState,
  fromIndex: number,
  predicate: (p: PlayerState) => boolean,
): number | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const index = (fromIndex + step) % n;
    if (predicate(state.players[index])) return index;
  }
  return null;
}

function dealCards(state: HandState, count: number): { deck: Card[]; cards: Card[] } {
  const cards = state.deck.slice(0, count);
  const deck = state.deck.slice(count);
  return { deck, cards };
}

function awardPot(
  potIndex: number,
  amount: number,
  eligiblePlayerIds: string[],
  players: PlayerState[],
  board: Card[],
  holeCards: HandState["holeCards"],
): PotResult {
  let winnerIds: string[];

  if (eligiblePlayerIds.length === 1) {
    winnerIds = eligiblePlayerIds;
  } else {
    const evaluated = eligiblePlayerIds.map((id) => evaluateHand(holeCards[id], board));
    const winnerIndices = winningIndices(evaluated);
    winnerIds = winnerIndices.map((i) => eligiblePlayerIds[i]);
  }

  const amounts: Record<string, number> = {};
  const base = Math.floor(amount / winnerIds.length);
  let remainder = amount - base * winnerIds.length;

  // Odd chips from an uneven split go one-by-one to winners in seat order,
  // starting from the eligible player list order (callers pass it in
  // dealer-relative order so this matches the standard house rule).
  for (const id of winnerIds) {
    amounts[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }

  for (const id of winnerIds) {
    const player = players.find((p) => p.id === id)!;
    player.stack += amounts[id];
  }

  return { potIndex, amount, winnerIds, amounts };
}

function resolveShowdown(state: HandState): ApplyActionResult {
  const players = state.players.map((p) => ({ ...p }));
  const contenders = players.filter((p) => !p.isFolded);

  const pots: PotResult[] =
    contenders.length === 1
      ? [
          {
            potIndex: 0,
            amount: players.reduce((sum, p) => sum + p.committedTotal, 0),
            winnerIds: [contenders[0].id],
            amounts: { [contenders[0].id]: players.reduce((sum, p) => sum + p.committedTotal, 0) },
          },
        ]
      : computeSidePots(players).map((pot, index) =>
          awardPot(index, pot.amount, pot.eligiblePlayerIds, players, state.board, state.holeCards),
        );

  // The single-contender fast path above doesn't go through awardPot, so it
  // needs its own stack credit.
  if (contenders.length === 1) {
    const winner = players.find((p) => p.id === contenders[0].id)!;
    winner.stack += pots[0].amount;
  }

  // Every pot has now been paid into the winners' stacks -- committed chips
  // no longer belong to anyone "in the pot", so clear them. Skipping this
  // would double-count them (once as stack, once as still-committed) in any
  // total-chips invariant.
  for (const player of players) {
    player.committedTotal = 0;
    player.committedThisStreet = 0;
  }

  const finalState: HandState = { ...state, players, status: "complete" };
  return {
    state: finalState,
    events: [{ type: "hand_complete", pots }],
    effectiveActionType: "call", // unused for this synthetic result; see applyAction
  };
}

function dealNextStreetCards(state: HandState): { state: HandState; event: EngineEvent } {
  const currentIndex = STREET_ORDER.indexOf(state.street);
  const nextStreet = STREET_ORDER[currentIndex + 1];
  const count = nextStreet === "flop" ? 3 : 1;
  const { deck, cards } = dealCards(state, count);
  const board = [...state.board, ...cards];

  const players = state.players.map((p) => ({ ...p, committedThisStreet: 0 }));

  const nextState: HandState = {
    ...state,
    deck,
    board,
    players,
    street: nextStreet,
    currentBet: 0,
    minRaise: state.bigBlind,
    lastAggressorIndex: null,
  };
  return { state: nextState, event: { type: "street_dealt", street: nextStreet, board } };
}

// Deals every remaining street in one go with no betting in between --
// correct behavior once enough players are all-in that no further decisions
// are possible (a real table "runs the board out").
function runOutRemainingStreets(state: HandState): ApplyActionResult {
  let working = state;
  const events: EngineEvent[] = [];

  while (working.street !== "river") {
    const { state: dealt, event } = dealNextStreetCards(working);
    working = dealt;
    events.push(event);
  }

  const showdown = resolveShowdown(working);
  return { state: showdown.state, events: [...events, ...showdown.events], effectiveActionType: "call" };
}

// Call after any state change (a player's action, or blinds just posted) to
// check whether the current street's betting has closed and, if so, either
// deal the next street, run out the board, or resolve the showdown. A no-op
// (returns state unchanged) if betting is still live.
export function maybeAdvanceStreetOrShowdown(state: HandState): ApplyActionResult {
  const contenders = nonFoldedPlayers(state);
  if (contenders.length === 1) {
    return resolveShowdown(state);
  }

  if (state.actionsRemainingThisStreet > 0) {
    return { state, events: [], effectiveActionType: "call" };
  }

  if (state.street === "river") {
    return resolveShowdown(state);
  }

  if (playersWhoCanAct(state).length <= 1) {
    return runOutRemainingStreets(state);
  }

  const { state: dealt, event } = dealNextStreetCards(state);
  const actingIndex = findNextIndex(dealt, dealt.dealerIndex, canAct);
  const nextState: HandState = {
    ...dealt,
    actingIndex: actingIndex ?? dealt.dealerIndex,
    actionsRemainingThisStreet: playersWhoCanAct(dealt).length,
  };
  return { state: nextState, events: [event], effectiveActionType: "call" };
}

export function applyAction(state: HandState, action: Action): ApplyActionResult {
  const actorIndex = state.actingIndex;
  const actor = state.players[actorIndex];

  if (actor.id !== action.playerId) {
    throw new Error(`It is not ${action.playerId}'s turn`);
  }
  if (actor.isFolded || actor.isAllIn) {
    throw new Error(`${action.playerId} cannot act (folded or all-in)`);
  }

  const players = state.players.map((p) => ({ ...p }));
  const player = players[actorIndex];
  const toCall = state.currentBet - player.committedThisStreet;

  let effectiveActionType: ActionType;
  let nextCurrentBet = state.currentBet;
  let nextMinRaise = state.minRaise;
  let nextLastAggressorIndex = state.lastAggressorIndex;
  let closesAction = true; // false when this action reopens betting for everyone else

  switch (action.type) {
    case "fold": {
      player.isFolded = true;
      effectiveActionType = "fold";
      break;
    }
    case "check": {
      if (toCall !== 0) throw new Error("Cannot check when facing a bet");
      effectiveActionType = "check";
      break;
    }
    case "call": {
      if (toCall <= 0) throw new Error("Nothing to call -- use check instead");
      const amount = Math.min(toCall, player.stack);
      player.stack -= amount;
      player.committedThisStreet += amount;
      player.committedTotal += amount;
      if (player.stack === 0) player.isAllIn = true;
      effectiveActionType = player.isAllIn ? "all_in" : "call";
      break;
    }
    case "raise": {
      const target = action.amount;
      if (target === undefined) throw new Error("raise requires an amount");
      const delta = target - player.committedThisStreet;
      if (delta <= 0 || delta > player.stack) {
        throw new Error("Invalid raise amount for this player's stack");
      }
      const increment = target - state.currentBet;
      const isAllInRaise = delta === player.stack;
      if (increment <= 0) {
        throw new Error("Raise must exceed the current bet");
      }
      // An all-in raise for less than a full min-raise is allowed (common
      // simplified house rule) but does not lower the bar for later raises.
      if (!isAllInRaise && increment < state.minRaise) {
        throw new Error("Raise does not meet the minimum raise size");
      }

      player.stack -= delta;
      player.committedThisStreet = target;
      player.committedTotal += delta;
      if (player.stack === 0) player.isAllIn = true;

      nextCurrentBet = target;
      nextMinRaise = Math.max(state.minRaise, increment);
      nextLastAggressorIndex = actorIndex;
      closesAction = false;

      effectiveActionType = player.isAllIn ? "all_in" : "raise";
      break;
    }
  }

  const stateAfterAction: HandState = {
    ...state,
    players,
    currentBet: nextCurrentBet,
    minRaise: nextMinRaise,
    lastAggressorIndex: nextLastAggressorIndex,
  };

  const actionsRemaining = closesAction
    ? state.actionsRemainingThisStreet - 1
    : playersWhoCanAct(stateAfterAction).length - 1;

  const nextActingIndex = findNextIndex(stateAfterAction, actorIndex, canAct);

  const stateBeforeAdvance: HandState = {
    ...stateAfterAction,
    actionsRemainingThisStreet: actionsRemaining,
    actingIndex: nextActingIndex ?? actorIndex,
  };

  const advanced = maybeAdvanceStreetOrShowdown(stateBeforeAdvance);
  return { ...advanced, effectiveActionType };
}
