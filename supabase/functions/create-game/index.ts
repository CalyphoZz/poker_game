import { withSupabase } from "@supabase/server";

interface CreateGameBody {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  maxPlayers?: number;
  turnDurationSeconds?: number;
}

function validationError(body: Partial<CreateGameBody>): string | null {
  if (!Number.isInteger(body.smallBlind) || body.smallBlind! <= 0) {
    return "smallBlind must be a positive integer";
  }
  if (!Number.isInteger(body.bigBlind) || body.bigBlind! <= body.smallBlind!) {
    return "bigBlind must be a positive integer greater than smallBlind";
  }
  if (!Number.isInteger(body.startingStack) || body.startingStack! <= 0) {
    return "startingStack must be a positive integer";
  }
  if (
    body.maxPlayers !== undefined &&
    (!Number.isInteger(body.maxPlayers) || body.maxPlayers < 2 || body.maxPlayers > 10)
  ) {
    return "maxPlayers must be an integer between 2 and 10";
  }
  if (
    body.turnDurationSeconds !== undefined &&
    (!Number.isInteger(body.turnDurationSeconds) || body.turnDurationSeconds <= 0)
  ) {
    return "turnDurationSeconds must be a positive integer";
  }
  return null;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const hostUserId = ctx.userClaims!.id;

    let body: Partial<CreateGameBody>;
    try {
      body = await req.json();
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
        p_small_blind: body.smallBlind,
        p_big_blind: body.bigBlind,
        p_starting_stack: body.startingStack,
        p_max_players: body.maxPlayers ?? 8,
        p_turn_duration_seconds: body.turnDurationSeconds ?? 25,
      })
      .single();

    if (rpcError) {
      return Response.json({ message: rpcError.message }, { status: 500 });
    }

    return Response.json({ game }, { status: 201 });
  }),
};
