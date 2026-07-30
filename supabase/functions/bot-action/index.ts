import { withSupabase } from "@supabase/server";
import { applyAction, decideBotAction } from "poker-engine";
import type { BotDifficulty } from "poker-engine";
import { loadHandState } from "../_shared/reconstructHandState.ts";
import { persistActionResult } from "../_shared/persistActionResult.ts";

// Triggered by any connected client the moment it observes that the current
// turn belongs to a bot (see the table screen) -- the same "any client can
// nudge the server" pattern as enforce-turn-timeout. It's a no-op (409) if
// it isn't actually a bot's turn, so it's safe to call speculatively and
// safe for more than one client to call at once (the optimistic-concurrency
// guard in persistActionResult means only one write ever lands).
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;

    let body: { handId?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }
    const handId = body.handId;
    if (typeof handId !== "string") {
      return Response.json({ message: "handId is required" }, { status: 400 });
    }

    const loaded = await loadHandState(admin, handId);
    if ("error" in loaded) {
      return Response.json({ message: loaded.error }, { status: loaded.status });
    }
    const { hand, state } = loaded;

    const { data: membership } = await admin
      .from("hand_players")
      .select("id")
      .eq("hand_id", handId)
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!membership) {
      return Response.json({ message: "You are not a member of this hand" }, { status: 403 });
    }

    // Both of these are legitimate no-ops, not errors: a client's table
    // screen calls this speculatively any time the turn changes, without
    // first checking client-side whether the new actor is a bot.
    if (state.actingIndex === -1) {
      return Response.json({ message: "No player is currently due to act" }, { status: 200 });
    }
    const actor = state.players[state.actingIndex];

    const { data: gamePlayer } = await admin
      .from("game_players")
      .select("is_bot, bot_difficulty")
      .eq("game_id", hand.game_id)
      .eq("user_id", actor.id)
      .maybeSingle();

    if (!gamePlayer?.is_bot) {
      return Response.json({ message: "It is not a bot's turn" }, { status: 200 });
    }

    const decision = decideBotAction(state, gamePlayer.bot_difficulty as BotDifficulty);

    let result: ReturnType<typeof applyAction>;
    try {
      result = applyAction(state, { type: decision.type, playerId: actor.id, amount: decision.amount });
    } catch (e) {
      // A bug in the heuristic producing an illegal action should never
      // wedge the table -- fall back to the safest always-legal action.
      const fallbackType = state.currentBet - actor.committedThisStreet <= 0 ? "check" : "fold";
      result = applyAction(state, { type: fallbackType, playerId: actor.id });
      console.error("bot decision was illegal, fell back to", fallbackType, e);
    }

    const actorAfter = result.state.players.find((p) => p.id === actor.id)!;
    const amountPaid = actorAfter.committedTotal - actor.committedTotal;

    const outcome = await persistActionResult(admin, loaded, result, {
      userId: actor.id,
      street: state.street,
      amount: amountPaid,
      clientActionId: crypto.randomUUID(),
    });

    if (!outcome.ok) {
      return Response.json({ message: "Hand state changed concurrently" }, { status: 200 });
    }

    return Response.json(
      { effectiveActionType: result.effectiveActionType, status: result.state.status },
      { status: 200 },
    );
  }),
};
