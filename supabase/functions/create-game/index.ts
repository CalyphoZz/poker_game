import { withSupabase } from "@supabase/server";

interface CreateGameBody {
  smallBlind?: number;
  bigBlind?: number;
  startingStack?: number;
  turnDurationSeconds?: number;
  blindIncreaseIntervalMinutes?: number;
}

// Table capacity is a fixed technical ceiling, not a host choice -- see the
// blind_timer_and_fixed_capacity migration.
const DEFAULT_SMALL_BLIND = 10;
const DEFAULT_BIG_BLIND = 20;
const DEFAULT_STARTING_STACK = 1000;
const DEFAULT_TURN_DURATION_SECONDS = 25;
const DEFAULT_BLIND_INCREASE_INTERVAL_MINUTES = 10;

function validationError(body: CreateGameBody): string | null {
  if (
    body.smallBlind !== undefined &&
    (!Number.isInteger(body.smallBlind) || body.smallBlind <= 0)
  ) {
    return "smallBlind must be a positive integer";
  }
  if (
    body.bigBlind !== undefined &&
    (!Number.isInteger(body.bigBlind) ||
      body.bigBlind <= (body.smallBlind ?? DEFAULT_SMALL_BLIND))
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

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const hostUserId = ctx.userClaims!.id;

    let body: CreateGameBody;
    try {
      const raw = await req.text();
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const error = validationError(body);
    if (error) {
      return Response.json({ message: error }, { status: 400 });
    }

    const { data: game, error: rpcError } = await ctx.supabaseAdmin
      .rpc("create_game_with_host", {
        p_host_user_id: hostUserId,
        p_small_blind: body.smallBlind ?? DEFAULT_SMALL_BLIND,
        p_big_blind: body.bigBlind ?? DEFAULT_BIG_BLIND,
        p_starting_stack: body.startingStack ?? DEFAULT_STARTING_STACK,
        p_turn_duration_seconds: body.turnDurationSeconds ?? DEFAULT_TURN_DURATION_SECONDS,
        p_blind_increase_interval_minutes:
          body.blindIncreaseIntervalMinutes ?? DEFAULT_BLIND_INCREASE_INTERVAL_MINUTES,
      })
      .single();

    if (rpcError) {
      return Response.json({ message: rpcError.message }, { status: 500 });
    }

    return Response.json({ game }, { status: 201 });
  }),
};
