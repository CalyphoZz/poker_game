import type { EngineEvent, HandState } from "poker-engine";

// supabase-js's fluent query builder type is awkward to reproduce precisely
// in a shared Deno module without importing the library's own types (which
// pulls in a subpath resolution we haven't verified in this runtime yet);
// `any` here is a deliberate, narrow exception for that reason.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

// Shared by start-hand (a hand can complete instantly if blinds alone put
// everyone all-in) and player-action (the common case): once the engine
// reports 'hand_complete', persist the side pots and credit each winner's
// live game_players.stack so it carries into the next hand.
export async function persistHandCompletion(
  supabaseAdmin: AdminClient,
  gameId: string,
  handId: string,
  finalState: HandState,
  events: EngineEvent[],
): Promise<void> {
  const handComplete = events.find((e): e is Extract<EngineEvent, { type: "hand_complete" }> =>
    e.type === "hand_complete",
  );
  if (!handComplete) return;

  await supabaseAdmin.from("side_pots").insert(
    handComplete.pots.map((pot) => ({
      hand_id: handId,
      pot_number: pot.potIndex,
      amount: pot.amount,
      eligible_user_ids: Object.keys(pot.amounts),
      winner_user_ids: pot.winnerIds,
    })),
  );

  await supabaseAdmin
    .from("hands")
    .update({ status: "complete", winners: handComplete.pots, ended_at: new Date().toISOString() })
    .eq("id", handId);

  for (const player of finalState.players) {
    await supabaseAdmin.from("game_players").update({ stack: player.stack }).eq(
      "game_id",
      gameId,
    ).eq("user_id", player.id);

    await supabaseAdmin
      .from("hand_players")
      .update({ final_stack: player.stack, stack: player.stack })
      .eq("hand_id", handId)
      .eq("user_id", player.id);
  }
}
