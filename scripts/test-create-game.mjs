// M1 integration check: signs in as a fresh anonymous user against the local
// Supabase stack, calls the create-game Edge Function, and verifies the
// resulting `games` + `game_players` rows -- exercising the real HTTP path
// with zero UI involved, per the M1 milestone's verification step.
//
// Usage: node scripts/test-create-game.mjs
// Requires `supabase start` and `supabase functions serve` (or deployed
// functions) to be running, and .env.local to be populated.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    const contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of contents.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) process.env[match[1]] ??= match[2];
    }
  } catch {
    // .env.local is optional if vars are already set in the environment
  }
}

loadEnvLocal();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, publishableKey);

const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
if (authError || !authData.session) {
  console.error("Anonymous sign-in failed:", authError);
  process.exit(1);
}
const hostUserId = authData.user.id;
console.log("Signed in anonymously as", hostUserId);

const { data: invokeData, error: invokeError } = await supabase.functions.invoke("create-game", {
  body: {
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    maxPlayers: 6,
    turnDurationSeconds: 25,
  },
});

if (invokeError) {
  console.error("create-game call failed:", invokeError);
  process.exit(1);
}

const game = invokeData.game;
console.log("create-game response:", game);

if (!game?.id || !game.invite_code) {
  console.error("Response missing expected fields");
  process.exit(1);
}

const { data: playerRows, error: playerError } = await supabase
  .from("game_players")
  .select("*")
  .eq("game_id", game.id);

if (playerError) {
  console.error("Could not read back game_players:", playerError);
  process.exit(1);
}

const hostSeat = playerRows.find((p) => p.user_id === hostUserId);
if (!hostSeat || hostSeat.stack !== 1000 || hostSeat.seat_number !== 1) {
  console.error("Host was not seated as expected:", playerRows);
  process.exit(1);
}

console.log("PASS: game created, host seated with correct starting stack.");

// RLS check: a second, unrelated anonymous user must not be able to see this
// game or its seats at all -- this is the core security guarantee the whole
// architecture depends on (private games, no matchmaking with strangers).
const outsider = createClient(url, publishableKey);
const { error: outsiderAuthError } = await outsider.auth.signInAnonymously();
if (outsiderAuthError) {
  console.error("Outsider sign-in failed:", outsiderAuthError);
  process.exit(1);
}

const { data: outsiderGameRows } = await outsider.from("games").select("*").eq("id", game.id);
const { data: outsiderPlayerRows } = await outsider
  .from("game_players")
  .select("*")
  .eq("game_id", game.id);

if ((outsiderGameRows?.length ?? 0) > 0 || (outsiderPlayerRows?.length ?? 0) > 0) {
  console.error(
    "SECURITY FAILURE: a non-member could read this game's rows:",
    outsiderGameRows,
    outsiderPlayerRows,
  );
  process.exit(1);
}

console.log("PASS: a non-member sees zero rows for this game (RLS enforced).");
