// Cards use pokersolver's own notation (rank + suit, e.g. "Ah", "Td", "2c")
// so hand evaluation never needs to convert between representations.
export type Card = string;

export type PlayerId = string;

export type Street = "preflop" | "flop" | "turn" | "river";

// The full vocabulary used for logging/persistence (mirrors
// hand_actions.action_type in the DB schema).
export type ActionType = "post_sb" | "post_bb" | "fold" | "check" | "call" | "raise" | "all_in";

// What a player can actually choose to do on their turn. 'post_sb'/'post_bb'
// are produced internally when a hand starts (see blinds.ts), never chosen
// by a player; 'all_in' is never a distinct *choice* either -- it is what a
// 'call' or 'raise' becomes when it happens to use a player's entire stack,
// reported back via ApplyActionResult.effectiveActionType for logging.
export type PlayerActionType = "fold" | "check" | "call" | "raise";

export interface PlayerState {
  id: PlayerId;
  stack: number;
  committedTotal: number;
  committedThisStreet: number;
  isFolded: boolean;
  isAllIn: boolean;
}

export interface HandState {
  players: PlayerState[]; // seat order, starting from the player left of the dealer
  dealerIndex: number; // index into `players`
  smallBlindIndex: number; // index into `players`, fixed for the whole hand
  bigBlindIndex: number; // index into `players`, fixed for the whole hand
  street: Street;
  board: Card[];
  deck: Card[]; // remaining undealt cards, top of deck at index 0
  holeCards: Record<PlayerId, [Card, Card]>;
  currentBet: number; // highest committedThisStreet among active players
  minRaise: number; // minimum legal raise increment for the next raise
  actingIndex: number; // index into `players` of whose turn it is
  lastAggressorIndex: number | null;
  actionsRemainingThisStreet: number;
  smallBlind: number;
  bigBlind: number;
  status: "in_progress" | "complete";
}

export interface Action {
  type: PlayerActionType;
  playerId: PlayerId;
  amount?: number; // total amount committed this street after the raise, for 'raise' only
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: PlayerId[];
}

export interface PotResult {
  potIndex: number;
  amount: number;
  winnerIds: PlayerId[];
  amounts: Record<PlayerId, number>;
}

export type EngineEvent =
  | { type: "street_dealt"; street: Street; board: Card[] }
  | { type: "hand_complete"; pots: PotResult[] };

export interface ApplyActionResult {
  state: HandState;
  events: EngineEvent[];
  // What actually happened, for the caller to log in hand_actions -- may
  // differ from the input action's `type` (a 'call' or 'raise' that uses a
  // player's whole stack is reported as 'all_in').
  effectiveActionType: ActionType;
}
