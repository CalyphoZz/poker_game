// M2 integration check: host creates a game, a second player joins by code,
// toggles ready, then leaves -- exercising join-game, the direct is_ready
// column-grant update, and leave-game against the real local stack.
//
// Usage: node scripts/test-lobby.mjs
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

async function signInAnon() {
  const client = createClient(url, publishableKey);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) {
    throw error ?? new Error("signInAnonymously returned no session");
  }
  return { client, userId: data.user.id };
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

const host = await signInAnon();
console.log("Host:", host.userId);

const { data: createData, error: createError } = await host.client.functions.invoke(
  "create-game",
  { body: { smallBlind: 10, bigBlind: 20, startingStack: 1000, maxPlayers: 3 } },
);
assert(!createError, `create-game failed: ${createError?.message}`);
const game = createData.game;
console.log("Game created:", game.invite_code, "max_players:", game.max_players);

const guest = await signInAnon();
console.log("Guest:", guest.userId);

const { data: joinData, error: joinError } = await guest.client.functions.invoke("join-game", {
  body: { inviteCode: game.invite_code },
});
assert(!joinError, `join-game failed: ${joinError?.message}`);
assert(joinData.player.user_id === guest.userId, "join-game returned the wrong player row");
assert(joinData.player.seat_number === 2, `expected seat 2, got ${joinData.player.seat_number}`);
assert(joinData.player.stack === 1000, "guest should start with the game's starting stack");
console.log("PASS: guest joined at seat", joinData.player.seat_number);

// Idempotent re-join: calling join-game again for an already-active member
// must return the same seat, not error or reassign.
const { data: rejoinData, error: rejoinError } = await guest.client.functions.invoke(
  "join-game",
  { body: { inviteCode: game.invite_code } },
);
assert(!rejoinError, `idempotent re-join failed: ${rejoinError?.message}`);
assert(rejoinData.player.seat_number === 2, "idempotent re-join changed the guest's seat");
console.log("PASS: re-joining an already-active game is idempotent");

// A stranger trying to join with a garbage code should get a clean 404, not
// a 500 or a silent success.
const stranger = await signInAnon();
const { error: badCodeError } = await stranger.client.functions.invoke("join-game", {
  body: { inviteCode: "ZZZZZZ" },
});
assert(badCodeError, "joining with an invalid code should fail");
console.log("PASS: invalid invite code is rejected");

// Capacity enforcement: this game was created with maxPlayers: 3. Host (seat
// 1) + guest (seat 2) are already in, so a third player fills the table and
// a fourth must be turned away rather than silently over-seated.
const third = await signInAnon();
const { data: thirdJoinData, error: thirdJoinError } = await third.client.functions.invoke(
  "join-game",
  { body: { inviteCode: game.invite_code } },
);
assert(!thirdJoinError, `third player join failed: ${thirdJoinError?.message}`);
assert(thirdJoinData.player.seat_number === 3, "third player should take seat 3");
console.log("PASS: third player fills the table (seat 3/3)");

const fourth = await signInAnon();
const { error: fourthJoinError } = await fourth.client.functions.invoke("join-game", {
  body: { inviteCode: game.invite_code },
});
assert(fourthJoinError, "joining a full game should fail");
console.log("PASS: a full game rejects a fourth player");

// Direct, RLS-scoped is_ready toggle (no Edge Function involved).
const { data: readyRow, error: readyError } = await guest.client
  .from("game_players")
  .update({ is_ready: true })
  .eq("id", joinData.player.id)
  .select()
  .single();
assert(!readyError, `is_ready update failed: ${readyError?.message}`);
assert(readyRow.is_ready === true, "is_ready did not toggle");
console.log("PASS: guest can toggle their own is_ready directly");

// A client must not be able to smuggle other columns into that same update.
const { error: stackTamperError } = await guest.client
  .from("game_players")
  .update({ is_ready: false, stack: 999999 })
  .eq("id", joinData.player.id);
assert(stackTamperError, "client should not be able to write game_players.stack directly");
console.log("PASS: attempting to also write `stack` in the same update is rejected");

// Leave, then verify the seat is freed and rejoin gets a fresh seat.
const { data: leaveData, error: leaveError } = await guest.client.functions.invoke("leave-game", {
  body: { gameId: game.id },
});
assert(!leaveError, `leave-game failed: ${leaveError?.message}`);
assert(leaveData.player.status === "left", "leave-game did not mark the player as left");
assert(leaveData.player.seat_number === null, "leave-game did not free the seat");
console.log("PASS: guest left, seat freed");

const { data: rejoinAfterLeave, error: rejoinAfterLeaveError } = await guest.client.functions.invoke(
  "join-game",
  { body: { inviteCode: game.invite_code } },
);
assert(!rejoinAfterLeaveError, `rejoin after leave failed: ${rejoinAfterLeaveError?.message}`);
assert(rejoinAfterLeave.player.status === "seated", "rejoin should reactivate the player as seated");
assert(rejoinAfterLeave.player.seat_number === 2, "rejoin should reuse the freed seat");
console.log("PASS: guest rejoined after leaving, seat reassigned correctly");

console.log("\nALL LOBBY CHECKS PASSED");
