import { withSupabase } from "@supabase/server";

// Only lets a player top back up to the table's starting stack, only once
// they've actually busted (stack === 0) -- matching the brief's "unlimited
// rebuy between hands for busted players" cash-game policy. A player who
// still has chips can't use this to top up mid-session.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;

    let body: { gameId?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }
    const gameId = body.gameId;
    if (typeof gameId !== "string") {
      return Response.json({ message: "gameId is required" }, { status: 400 });
    }

    const { data: game } = await admin.from("games").select("starting_stack").eq("id", gameId).single();
    if (!game) {
      return Response.json({ message: "Game not found" }, { status: 404 });
    }

    const { data: player } = await admin
      .from("game_players")
      .select("id, stack")
      .eq("game_id", gameId)
      .eq("user_id", callerUserId)
      .neq("status", "left")
      .maybeSingle();
    if (!player) {
      return Response.json({ message: "You are not a member of this game" }, { status: 403 });
    }
    if (player.stack > 0) {
      return Response.json({ message: "You can only rebuy once your stack reaches 0" }, { status: 409 });
    }

    const { data: updated, error } = await admin
      .from("game_players")
      .update({ stack: game.starting_stack })
      .eq("id", player.id)
      .select()
      .single();

    if (error) {
      return Response.json({ message: error.message }, { status: 500 });
    }

    return Response.json({ player: updated }, { status: 200 });
  }),
};
