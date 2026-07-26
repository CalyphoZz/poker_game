import { withSupabase } from "@supabase/server";

const RPC_ERROR_STATUS: Record<string, number> = {
  P0004: 409, // not an active member
};

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const userId = ctx.userClaims!.id;

    let body: { gameId?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const gameId = body.gameId;
    if (typeof gameId !== "string" || gameId.trim().length === 0) {
      return Response.json({ message: "gameId is required" }, { status: 400 });
    }

    const { data: player, error } = await ctx.supabaseAdmin
      .rpc("leave_game", {
        p_game_id: gameId,
        p_user_id: userId,
      })
      .single();

    if (error) {
      const status = RPC_ERROR_STATUS[error.code ?? ""] ?? 500;
      return Response.json({ message: error.message }, { status });
    }

    return Response.json({ player }, { status: 200 });
  }),
};
