import { withSupabase } from "@supabase/server";
import { applyAction } from "poker-engine";
import { loadHandState } from "../_shared/reconstructHandState.ts";
import { persistActionResult } from "../_shared/persistActionResult.ts";

// Lazy timeout enforcement (see architecture plan section 3): any game
// member can call this the instant their local countdown hits zero. It is a
// no-op unless the server's own turn_deadline has actually passed, so it is
// safe to call speculatively and safe for multiple clients to call at once
// -- the same optimistic-concurrency guard used by player-action means only
// one caller's write ever lands.
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

    const isMember = await admin
      .from("hand_players")
      .select("id")
      .eq("hand_id", handId)
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!isMember.data) {
      return Response.json({ message: "You are not a member of this hand" }, { status: 403 });
    }

    if (!hand.turn_deadline || new Date(hand.turn_deadline).getTime() > Date.now()) {
      return Response.json({ message: "Turn has not timed out yet" }, { status: 200 });
    }
    if (state.actingIndex === -1) {
      return Response.json({ message: "No player is currently due to act" }, { status: 409 });
    }

    const actor = state.players[state.actingIndex];
    const toCall = state.currentBet - actor.committedThisStreet;
    const syntheticType = toCall <= 0 ? "check" : "fold";

    const result = applyAction(state, { type: syntheticType, playerId: actor.id });

    const outcome = await persistActionResult(admin, loaded, result, {
      userId: actor.id,
      street: state.street,
      amount: 0,
      clientActionId: crypto.randomUUID(),
    });

    if (!outcome.ok) {
      return Response.json(
        { message: "Hand state changed concurrently -- no action needed" },
        { status: 200 },
      );
    }

    return Response.json(
      { effectiveActionType: result.effectiveActionType, status: result.state.status },
      { status: 200 },
    );
  }),
};
