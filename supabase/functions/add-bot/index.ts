import { withSupabase } from "@supabase/server";

const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

// A bot's auth.users row is created with a real (fake) email so it has a
// stable, real identity like any other player -- which means is_anonymous
// is false for it, so handle_new_user()'s guest-vs-account split (see the
// animal_names_guests_only migration) would otherwise name it after that
// throwaway email instead of an animal. A bot is neither a guest nor a real
// account, so its name is generated here explicitly rather than relying on
// that trigger's default.
const ADJECTIVES = [
  "Swift", "Clever", "Brave", "Lazy", "Sneaky", "Happy", "Grumpy", "Fuzzy",
  "Mighty", "Silent", "Jolly", "Wild", "Gentle", "Fierce", "Curious",
  "Bouncy", "Sly", "Bold", "Chill", "Zippy",
];
const ANIMALS = [
  "Fox", "Panda", "Owl", "Wolf", "Otter", "Falcon", "Bear", "Tiger",
  "Rabbit", "Koala", "Eagle", "Shark", "Lynx", "Raccoon", "Beaver", "Hawk",
  "Penguin", "Dolphin", "Moose", "Badger",
];
function randomAnimalName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adjective}${animal}`;
}

// A bot is a real auth.users row created here via the admin API -- it never
// signs in, but this means it flows through handle_new_user() -> profiles
// exactly like a real signup, and through game_players/hand_players exactly
// like a real player, with zero special-casing in the engine or RLS.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;
    const admin = ctx.supabaseAdmin;

    let body: { gameId?: unknown; difficulty?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ message: "Invalid JSON body" }, { status: 400 });
    }
    const gameId = body.gameId;
    const difficulty = body.difficulty;
    if (typeof gameId !== "string") {
      return Response.json({ message: "gameId is required" }, { status: 400 });
    }
    if (typeof difficulty !== "string" || !VALID_DIFFICULTIES.includes(difficulty)) {
      return Response.json({ message: "difficulty must be easy/medium/hard" }, { status: 400 });
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

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `bot-${crypto.randomUUID()}@bots.invalid`,
      email_confirm: true,
      user_metadata: { is_bot: true },
    });
    if (createError || !created.user) {
      return Response.json(
        { message: createError?.message ?? "Failed to create the bot's identity" },
        { status: 500 },
      );
    }
    const botUserId = created.user.id;

    const { data: player, error: seatError } = await admin
      .rpc("add_bot_to_game", {
        p_game_id: gameId,
        p_bot_user_id: botUserId,
        p_difficulty: difficulty,
      })
      .single();

    if (seatError) {
      await admin.auth.admin.deleteUser(botUserId);
      const status = seatError.code === "P0003" || seatError.code === "P0006" ? 409 : 500;
      return Response.json({ message: seatError.message }, { status });
    }

    // Prefix a fresh animal name so the bot is unmistakable anywhere a
    // display_name shows up, not just where the UI checks is_bot.
    await admin
      .from("profiles")
      .update({ display_name: `🤖 ${randomAnimalName()}` })
      .eq("id", botUserId);

    return Response.json({ player }, { status: 201 });
  }),
};
