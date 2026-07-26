import type { HandState, PlayerState } from "poker-engine";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface LoadedHand {
  hand: Record<string, unknown> & {
    id: string;
    game_id: string;
    status: string;
    state_version: number;
    current_street: HandState["street"];
    board_cards: string[];
    current_bet: number;
    min_raise: number;
    actions_remaining_this_street: number;
    dealer_user_id: string;
    small_blind_user_id: string;
    big_blind_user_id: string;
    current_turn_user_id: string | null;
    last_aggressor_user_id: string | null;
    turn_deadline: string | null;
  };
  game: { small_blind: number; big_blind: number; turn_duration_seconds: number };
  state: HandState;
}

// Shared by player-action and enforce-turn-timeout: both need to rebuild the
// exact HandState the engine last returned before they can call into
// applyAction again.
export async function loadHandState(
  admin: AdminClient,
  handId: string,
): Promise<LoadedHand | { error: string; status: number }> {
  const { data: hand, error: handError } = await admin.from("hands").select("*").eq("id", handId).single();
  if (handError || !hand) {
    return { error: "Hand not found", status: 404 };
  }
  if (hand.status !== "in_progress") {
    return { error: "This hand is already complete", status: 409 };
  }

  const { data: game } = await admin
    .from("games")
    .select("small_blind, big_blind, turn_duration_seconds")
    .eq("id", hand.game_id)
    .single();
  if (!game) {
    return { error: "Game not found", status: 500 };
  }

  const { data: handPlayers } = await admin
    .from("hand_players")
    .select("*")
    .eq("hand_id", handId)
    .order("seat_number", { ascending: true });
  if (!handPlayers || handPlayers.length === 0) {
    return { error: "Hand has no players", status: 500 };
  }

  const { data: deckRow } = await admin
    .from("hand_deck_state")
    .select("remaining_deck")
    .eq("hand_id", handId)
    .single();
  if (!deckRow) {
    return { error: "Missing deck state", status: 500 };
  }

  const { data: holeCardRows } = await admin
    .from("hand_hole_cards")
    .select("user_id, cards")
    .eq("hand_id", handId);

  const holeCards: HandState["holeCards"] = {};
  for (const row of holeCardRows ?? []) {
    holeCards[row.user_id as string] = row.cards as [string, string];
  }

  const dealerIndex = handPlayers.findIndex((p: { user_id: string }) => p.user_id === hand.dealer_user_id);
  const smallBlindIndex = handPlayers.findIndex(
    (p: { user_id: string }) => p.user_id === hand.small_blind_user_id,
  );
  const bigBlindIndex = handPlayers.findIndex((p: { user_id: string }) => p.user_id === hand.big_blind_user_id);
  const actingIndex = handPlayers.findIndex(
    (p: { user_id: string }) => p.user_id === hand.current_turn_user_id,
  );
  const lastAggressorIndex = hand.last_aggressor_user_id
    ? handPlayers.findIndex((p: { user_id: string }) => p.user_id === hand.last_aggressor_user_id)
    : null;

  const players: PlayerState[] = handPlayers.map((p: Record<string, unknown>) => ({
    id: p.user_id as string,
    stack: p.stack as number,
    committedTotal: p.committed_total as number,
    committedThisStreet: p.committed_this_street as number,
    isFolded: p.is_folded as boolean,
    isAllIn: p.is_all_in as boolean,
  }));

  const state: HandState = {
    players,
    dealerIndex,
    smallBlindIndex,
    bigBlindIndex,
    street: hand.current_street,
    board: hand.board_cards,
    deck: deckRow.remaining_deck,
    holeCards,
    currentBet: hand.current_bet,
    minRaise: hand.min_raise,
    actingIndex,
    lastAggressorIndex,
    actionsRemainingThisStreet: hand.actions_remaining_this_street,
    smallBlind: game.small_blind,
    bigBlind: game.big_blind,
    status: "in_progress",
  };

  return { hand, game, state };
}
