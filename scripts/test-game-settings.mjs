// M6 integration check: the lobby's host-only settings wheel. Covers the
// happy path (host changes blinds/stack/timers pre-game, and every seated
// player's stack syncs to the new starting stack), plus the two guards:
// non-host callers are rejected, and settings become immutable the moment
// the game's first hand has been dealt.
//
// Usage: node scripts/test-game-settings.mjs
// Requires `supabase start` + `supabase functions serve` running and
// .env.local populated.

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
    // optional
  }
}
loadEnvLocal();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

async function signInAnon() {
  const client = createClient(url, publishableKey);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) throw error ?? new Error("signInAnonymously returned no session");
  return { client, userId: data.user.id };
}

function invoke(client, fn, body) {
  return client.functions.invoke(fn, { body });
}

const host = await signInAnon();
const guest = await signInAnon();
console.log("host:", host.userId, "guest:", guest.userId);

const { data: createData, error: createError } = await invoke(host.client, "create-game", {});
assert(!createError, `create-game failed: ${createError?.message}`);
const game = createData.game;

const { error: joinError } = await invoke(guest.client, "join-game", { inviteCode: game.invite_code });
assert(!joinError, `join-game failed: ${joinError?.message}`);

// A non-host cannot touch settings.
const { error: nonHostError } = await invoke(guest.client, "update-game-settings", {
  gameId: game.id,
  startingStack: 5000,
});
assert(nonHostError, "a non-host should not be able to change game settings");
console.log("PASS: only the host can change game settings");

// The host changes blinds/stack/timers; every seated player's stack syncs.
const { data: updateData, error: updateError } = await invoke(host.client, "update-game-settings", {
  gameId: game.id,
  smallBlind: 25,
  bigBlind: 50,
  startingStack: 2000,
  turnDurationSeconds: 45,
  blindIncreaseIntervalMinutes: 20,
});
assert(!updateError, `host settings update failed: ${updateError?.message}`);
assert(
  updateData.game.small_blind === 25 &&
    updateData.game.big_blind === 50 &&
    updateData.game.starting_stack === 2000 &&
    updateData.game.turn_duration_seconds === 45 &&
    updateData.game.blind_increase_interval_minutes === 20,
  `settings did not persist as expected: ${JSON.stringify(updateData.game)}`,
);
console.log("PASS: host can update blinds/stack/turn timer/blind interval before the game starts");

const { data: players } = await host.client.from("game_players").select("user_id, stack").eq("game_id", game.id);
assert(
  players.every((p) => p.stack === 2000),
  `expected every seated player's stack to sync to the new starting stack, got ${JSON.stringify(players)}`,
);
console.log("PASS: changing the starting stack pre-game syncs every already-seated player");

// Once a hand has been dealt, settings become immutable.
const { error: startError } = await invoke(host.client, "start-hand", { gameId: game.id });
assert(!startError, `start-hand failed: ${startError?.message}`);

const { error: postGameError } = await invoke(host.client, "update-game-settings", {
  gameId: game.id,
  startingStack: 9999,
});
assert(postGameError, "settings should be immutable once the first hand has started");
console.log("PASS: settings can no longer be changed once a hand has been dealt");

console.log("\nALL GAME-SETTINGS CHECKS PASSED");
