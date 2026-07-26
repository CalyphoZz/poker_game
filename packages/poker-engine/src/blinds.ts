import { maybeAdvanceStreetOrShowdown } from "./betting.ts";
import { createDeck, shuffle } from "./deck.ts";
import type { ApplyActionResult, HandState, PlayerId, PlayerState } from "./types.ts";

export interface StartHandParams {
  // Eligible players only (status='seated' and stack>0), in fixed seat
  // order. This same order is preserved as HandState.players for the whole
  // hand -- dealerIndex/actingIndex are pointers into it.
  players: { id: PlayerId; stack: number }[];
  // The previous hand's dealer, or null for the game's very first hand.
  // Rotation looks this player up by id (not array index) so a player who
  // left/busted between hands doesn't desync seat rotation.
  previousDealerId: PlayerId | null;
  smallBlind: number;
  bigBlind: number;
  randomSource?: () => number;
}

function resolveDealerIndex(players: { id: PlayerId }[], previousDealerId: PlayerId | null): number {
  if (previousDealerId === null) return 0;
  const previousIndex = players.findIndex((p) => p.id === previousDealerId);
  if (previousIndex === -1) return 0; // previous dealer is no longer at the table
  return (previousIndex + 1) % players.length;
}

function postBlind(player: PlayerState, amount: number): void {
  const posted = Math.min(amount, player.stack);
  player.stack -= posted;
  player.committedThisStreet += posted;
  player.committedTotal += posted;
  if (player.stack === 0) player.isAllIn = true;
}

// Builds the initial preflop HandState for a new hand: rotates the dealer,
// shuffles and deals hole cards, posts blinds, and figures out who acts
// first -- including the heads-up special case where the dealer posts the
// small blind and acts first preflop (but *not* postflop).
export function startNewHand(params: StartHandParams): ApplyActionResult {
  const { players: inputPlayers, previousDealerId, smallBlind, bigBlind } = params;
  const randomSource = params.randomSource ?? Math.random;

  if (inputPlayers.length < 2) {
    throw new Error("startNewHand requires at least 2 eligible players");
  }

  const players: PlayerState[] = inputPlayers.map((p) => ({
    id: p.id,
    stack: p.stack,
    committedTotal: 0,
    committedThisStreet: 0,
    isFolded: false,
    isAllIn: false,
  }));

  const dealerIndex = resolveDealerIndex(inputPlayers, previousDealerId);
  const n = players.length;
  const isHeadsUp = n === 2;

  const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % n;
  const bbIndex = (sbIndex + 1) % n;

  const deck = shuffle(createDeck(), randomSource);
  const holeCards: HandState["holeCards"] = {};
  // Deal one card at a time, twice around starting from small blind, as at
  // a real table. Order has no effect on fairness given a proper shuffle.
  for (let round = 0; round < 2; round++) {
    for (let seat = 0; seat < n; seat++) {
      const index = (sbIndex + seat) % n;
      const id = players[index].id;
      const [card] = deck.splice(0, 1);
      holeCards[id] = round === 0 ? [card, ""] : [holeCards[id][0], card];
    }
  }

  postBlind(players[sbIndex], smallBlind);
  postBlind(players[bbIndex], bigBlind);

  // Preflop first-to-act: the seat after the big blind, wrapping around to
  // the dealer in a full-ring game, or the dealer/small blind themselves in
  // heads-up (since bbIndex+1 wraps straight back to sbIndex === dealerIndex
  // when n === 2).
  const actingIndex = (bbIndex + 1) % n;

  const initialState: HandState = {
    players,
    dealerIndex,
    smallBlindIndex: sbIndex,
    bigBlindIndex: bbIndex,
    street: "preflop",
    board: [],
    deck,
    holeCards,
    currentBet: players[bbIndex].committedThisStreet,
    minRaise: bigBlind,
    actingIndex,
    lastAggressorIndex: bbIndex,
    actionsRemainingThisStreet: players.filter((p) => !p.isAllIn).length,
    smallBlind,
    bigBlind,
    status: "in_progress",
  };

  // Handles the rare case where blinds alone already put everyone all-in
  // (e.g. two short stacks heads-up) -- runs the board out immediately
  // instead of waiting for an action that can never come.
  return maybeAdvanceStreetOrShowdown(initialState);
}
