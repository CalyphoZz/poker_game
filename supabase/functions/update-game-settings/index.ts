import { withSupabase } from "@supabase/server";

interface UpdateGameSettingsBody {
  smallBlind?: number;
  bigBlind?: number;
  startingStack?: number;
  turnDurationSeconds?: number;
  blindIncreaseIntervalMinutes?: number;
}

function validationError(
  body: UpdateGameSettingsBody,
  currentSmallBlind: number,
): string | null {
  if (
    body.smallBlind !== undefined &&
    (!Number.isInteger(body.smallBlind) || body.smallBlind <= 0)
  ) {
    return "smallBlind must be a positive integer";
  }
  if (
    body.bigBlind !== undefined &&
    (!Number.isInteger(body.bigBlind) ||
      body.bigBlind <= (body.smallBlind ?? currentSmallBlind))
  ) {
    return "bigBlind must be a positive integer greater than smallBlind";
  }
  if (
    body.startingStack !== undefined &&
    (!Number.isInteger(body.startingStack) || body.startingStack <= 0)
  ) {
    return "startingStack must be a positive integer";
  }
  if (
    body.turnDurationSeconds !== undefined &&
    (!Number.isInteger(body.turnDurationSeconds) || body.turnDurationSeconds <= 0)
  ) {
    return "turnDurationSeconds must be a positive integer";
  }
  if (
    body.blindIncreaseIntervalMinutes !== undefined &&
    (!Number.isInteger(body.blindIncreaseIntervalMinutes) ||
      body.blindIncreaseIntervalMinutes <= 0)
  ) {
    return "blindIncreaseIntervalMinutes must be a positive integer";
  }
  return null;
}

// Host-only, and only before this game has ever dealt a hand -- once
// next_blind_increase_at's clock is running (see start-hand) or chips have
// actually been wagered, these settings stop being something the lobby's
// settings wheel can touch; the lobby screen itself never renders once a
// hand exists (it redirects straight to the table), so this is a defensive
// server-side mirror of that, not the primary guard.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;

    let body: UpdateGameSettingsBody;
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }
    const gameId = (body as { gameId?: unknown }).gameId;
    if (typeof gameId !== "string") {
      return Response.json({ message: "gameId is required" }, { status: 400 });
    }

    const { data: game } = await admin.from("games").select("*").eq("id", gameId).single();
    if (!game) {
      return Response.json({ message: "Game not found" }, { status: 404 });
    }
    if (game.host_user_id !== callerUserId) {
      return Response.json({ message: "Only the host can change game settings" }, { status: 403 });
    }

    const { count: handCount } = await admin
      .from("hands")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);
    if (handCount && handCount > 0) {
      return Response.json(
        { message: "Settings can only be changed before the first hand starts" },
        { status: 409 },
      );
    }

    const error = validationError(body, game.small_blind);
    if (error) {
      return Response.json({ message: error }, { status: 400 });
    }

    const updates: Record<string, number> = {};
    if (body.smallBlind !== undefined) updates.small_blind = body.smallBlind;
    if (body.bigBlind !== undefined) updates.big_blind = body.bigBlind;
    if (body.startingStack !== undefined) updates.starting_stack = body.startingStack;
    if (body.turnDurationSeconds !== undefined) updates.turn_duration_seconds = body.turnDurationSeconds;
    if (body.blindIncreaseIntervalMinutes !== undefined) {
      updates.blind_increase_interval_minutes = body.blindIncreaseIntervalMinutes;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ game }, { status: 200 });
    }

    const { data: updatedGame, error: updateError } = await admin
      .from("games")
      .update(updates)
      .eq("id", gameId)
      .select()
      .single();
    if (updateError || !updatedGame) {
      return Response.json({ message: updateError?.message ?? "Update failed" }, { status: 500 });
    }

    // Pre-game, "starting stack" describes every seated player's chips --
    // nobody has wagered anything yet, so keep them all in sync with it.
    if (body.startingStack !== undefined) {
      await admin
        .from("game_players")
        .update({ stack: body.startingStack })
        .eq("game_id", gameId)
        .neq("status", "left");
    }

    return Response.json({ game: updatedGame }, { status: 200 });
  }),
};
