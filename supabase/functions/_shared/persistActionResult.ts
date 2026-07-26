import type { ApplyActionResult, HandState } from "poker-engine";
import { persistHandCompletion } from "./persistHandCompletion.ts";
import type { LoadedHand } from "./reconstructHandState.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type PersistOutcome =
  | { ok: true }
  | { ok: false; conflict: true };

// Shared by player-action and enforce-turn-timeout: writes an ApplyActionResult
// back with the optimistic-concurrency guard (see hands.state_version), then
// the rest of the per-hand tables, then hands off to persistHandCompletion if
// the hand just ended. Both callers pass in the action they're logging --
// a real player decision, or a synthesized timeout fold/check.
export async function persistActionResult(
  admin: AdminClient,
  loaded: LoadedHand,
  result: ApplyActionResult,
  log: { userId: string; street: HandState["street"]; amount: number; clientActionId: string },
): Promise<PersistOutcome> {
  const { hand, game } = loaded;
  const { state: nextState, events, effectiveActionType } = result;
  const isComplete = nextState.status === "complete";

  const { data: updatedHandRows, error: updateError } = await admin
    .from("hands")
    .update({
      current_street: nextState.street,
      board_cards: nextState.board,
      pot_total: nextState.players.reduce((sum: number, p) => sum + p.committedTotal, 0),
      current_bet: nextState.currentBet,
      min_raise: nextState.minRaise,
      actions_remaining_this_street: nextState.actionsRemainingThisStreet,
      current_turn_user_id: isComplete ? null : nextState.players[nextState.actingIndex].id,
      turn_deadline: isComplete
        ? null
        : new Date(Date.now() + game.turn_duration_seconds * 1000).toISOString(),
      last_aggressor_user_id:
        nextState.lastAggressorIndex !== null
          ? nextState.players[nextState.lastAggressorIndex].id
          : null,
      status: nextState.status,
      state_version: hand.state_version + 1,
    })
    .eq("id", hand.id)
    .eq("state_version", hand.state_version)
    .select();

  if (updateError) {
    throw new Error(updateError.message);
  }
  if (!updatedHandRows || updatedHandRows.length === 0) {
    return { ok: false, conflict: true };
  }

  await admin.from("hand_deck_state").update({ remaining_deck: nextState.deck }).eq("hand_id", hand.id);

  for (const player of nextState.players) {
    await admin
      .from("hand_players")
      .update({
        stack: player.stack,
        committed_this_street: player.committedThisStreet,
        committed_total: player.committedTotal,
        is_folded: player.isFolded,
        is_all_in: player.isAllIn,
      })
      .eq("hand_id", hand.id)
      .eq("user_id", player.id);
  }

  const { data: lastAction } = await admin
    .from("hand_actions")
    .select("sequence_number")
    .eq("hand_id", hand.id)
    .order("sequence_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSequence = (lastAction?.sequence_number ?? 0) + 1;

  await admin.from("hand_actions").insert({
    hand_id: hand.id,
    user_id: log.userId,
    street: log.street,
    action_type: effectiveActionType,
    amount: log.amount,
    sequence_number: nextSequence,
    client_action_id: log.clientActionId,
  });

  if (isComplete) {
    await persistHandCompletion(admin, hand.game_id, hand.id, nextState, events);
  }

  return { ok: true };
}
