import { withSupabase } from "@supabase/server";

const RPC_ERROR_STATUS: Record<string, number> = {
  P0001: 410, // game has ended
  P0002: 404, // no game for that code
  P0003: 409, // game is full
};

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const userId = ctx.userClaims!.id;

    let body: { inviteCode?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }

    const inviteCode = body.inviteCode;
    if (typeof inviteCode !== "string" || inviteCode.trim().length === 0) {
      return Response.json({ message: "inviteCode is required" }, { status: 400 });
    }

    const { data: player, error } = await ctx.supabaseAdmin
      .rpc("join_game_by_code", {
        p_invite_code: inviteCode.trim(),
        p_user_id: userId,
      })
      .single();

    if (error) {
      const status = RPC_ERROR_STATUS[error.code ?? ""] ?? 500;
      return Response.json({ message: error.message }, { status });
    }

    const { data: game, error: gameError } = await ctx.supabaseAdmin
      .from("games")
      .select("*")
      .eq("id", player.game_id)
      .single();

    if (gameError) {
      return Response.json({ message: gameError.message }, { status: 500 });
    }

    return Response.json({ game, player }, { status: 200 });
  }),
};
