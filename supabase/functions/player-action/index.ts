import { withSupabase } from "@supabase/server";
import { applyAction } from "poker-engine";
import type { Action } from "poker-engine";
import { loadHandState } from "../_shared/reconstructHandState.ts";
import { persistActionResult } from "../_shared/persistActionResult.ts";

const VALID_ACTION_TYPES = ["fold", "check", "call", "raise"];

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;

    let body: {
      handId?: unknown;
      clientActionId?: unknown;
      action?: { type?: unknown; amount?: unknown };
    };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const handId = body.handId;
    const clientActionId = body.clientActionId;
    const actionType = body.action?.type;
    const actionAmount = body.action?.amount;

    if (typeof handId !== "string" || typeof clientActionId !== "string") {
      return Response.json({ message: "handId and clientActionId are required" }, { status: 400 });
    }
    if (typeof actionType !== "string" || !VALID_ACTION_TYPES.includes(actionType)) {
      return Response.json(
        { message: "action.type must be one of fold/check/call/raise" },
        { status: 400 },
      );
    }

    // Idempotency: a retried call with the same client_action_id for this
    // hand is a no-op success, not a re-application.
    const { data: existingAction } = await admin
      .from("hand_actions")
      .select("id")
      .eq("hand_id", handId)
      .eq("client_action_id", clientActionId)
      .maybeSingle();
    if (existingAction) {
      return Response.json({ message: "Action already applied" }, { status: 200 });
    }

    const loaded = await loadHandState(admin, handId);
    if ("error" in loaded) {
      return Response.json({ message: loaded.error }, { status: loaded.status });
    }
    const { hand, state } = loaded;

    if (state.actingIndex === -1) {
      return Response.json({ message: "No player is currently due to act" }, { status: 409 });
    }
    if (state.players[state.actingIndex].id !== callerUserId) {
      return Response.json({ message: "It is not your turn" }, { status: 403 });
    }

    const action: Action = {
      type: actionType as Action["type"],
      playerId: callerUserId,
      amount: typeof actionAmount === "number" ? actionAmount : undefined,
    };

    let result: ReturnType<typeof applyAction>;
    try {
      result = applyAction(state, action);
    } catch (e) {
      return Response.json(
        { message: e instanceof Error ? e.message : "Invalid action" },
        { status: 400 },
      );
    }

    const actorBefore = state.players[state.actingIndex];
    const actorAfter = result.state.players.find((p) => p.id === callerUserId)!;
    const amountPaid = actorAfter.committedTotal - actorBefore.committedTotal;

    const outcome = await persistActionResult(admin, loaded, result, {
      userId: callerUserId,
      street: state.street,
      amount: amountPaid,
      clientActionId,
    });

    if (!outcome.ok) {
      return Response.json(
        { message: "Hand state changed concurrently -- refetch and retry" },
        { status: 409 },
      );
    }

    return Response.json(
      { effectiveActionType: result.effectiveActionType, status: result.state.status },
      { status: 200 },
    );
  }),
};
