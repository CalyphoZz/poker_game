import { withSupabase } from "@supabase/server";

// Reuses leave_game exactly like a human leaving -- frees the seat the same
// way. Deliberately does NOT delete the bot's underlying auth user: profiles
// and game_players both reference it, and a departed player's game_players
// row is kept (soft "left", not deleted) for history, same as a human who
// quits -- deleting the auth user would violate that FK for no real benefit.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;

    let body: { gameId?: unknown; botUserId?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }
    const gameId = body.gameId;
    const botUserId = body.botUserId;
    if (typeof gameId !== "string" || typeof botUserId !== "string") {
      return Response.json({ message: "gameId and botUserId are required" }, { status: 400 });
    }

    const { data: membership } = await admin
      .from("game_players")
      .select("id")
      .eq("game_id", gameId)
      .eq("user_id", callerUserId)
      .neq("status", "left")
      .maybeSingle();
    if (!membership) {
      return Response.json({ message: "You are not a member of this game" }, { status: 403 });
    }

    const { data: bot } = await admin
      .from("game_players")
      .select("is_bot")
      .eq("game_id", gameId)
      .eq("user_id", botUserId)
      .maybeSingle();
    if (!bot?.is_bot) {
      return Response.json({ message: "That player is not a bot" }, { status: 400 });
    }

    const { data: player, error } = await admin
      .rpc("leave_game", { p_game_id: gameId, p_user_id: botUserId })
      .single();

    if (error) {
      return Response.json({ message: error.message }, { status: 500 });
    }

    return Response.json({ player }, { status: 200 });
  }),
};
