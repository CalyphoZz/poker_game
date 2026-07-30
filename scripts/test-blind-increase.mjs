// M6 integration check: blinds actually increase automatically during play.
// Real wall-clock waiting would make this test take as long as the blind
// interval itself, so instead this manipulates games.next_blind_increase_at
// directly via the service-role client to simulate elapsed time, then calls
// start-hand and asserts it caught up correctly.
//
// Usage: node scripts/test-blind-increase.mjs
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publishableKey || !serviceKey) {
  console.error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY",
  );
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

const admin = createClient(url, serviceKey);

const host = await signInAnon();
const guest = await signInAnon();
console.log("host:", host.userId, "guest:", guest.userId);

const { data: createData, error: createError } = await invoke(host.client, "create-game", {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  blindIncreaseIntervalMinutes: 10,
});
assert(!createError, `create-game failed: ${createError?.message}`);
const game = createData.game;
assert(game.next_blind_increase_at === null, "clock should not be running before the first hand");

const { error: joinError } = await invoke(guest.client, "join-game", { inviteCode: game.invite_code });
assert(!joinError, `join-game failed: ${joinError?.message}`);

// Hand 1: just bootstraps the clock, blinds must stay untouched.
const { data: start1, error: start1Error } = await invoke(host.client, "start-hand", { gameId: game.id });
assert(!start1Error, `first start-hand failed: ${start1Error?.message}`);
assert(start1.hand.status, "hand 1 should have started");

const { data: gameAfterHand1 } = await admin.from("games").select("*").eq("id", game.id).single();
assert(gameAfterHand1.small_blind === 10 && gameAfterHand1.big_blind === 20, "blinds must not change on hand 1");
assert(gameAfterHand1.next_blind_increase_at !== null, "the blind clock should now be running");
assert(gameAfterHand1.current_blind_level === 0, "blind level should still be 0 after hand 1");
console.log("PASS: blind clock bootstraps on the first hand without bumping blinds");

// Force the current hand to complete (both players check/call to showdown)
// so start-hand is willing to deal a new one, then rewind the clock into the
// past to simulate two intervals having elapsed while nobody was looking.
async function finishCurrentHand() {
  let hand = start1.hand;
  let guard = 0;
  while (hand.status === "in_progress" && guard < 30) {
    guard++;
    const actor = hand.current_turn_user_id === host.userId ? host.client : guest.client;
    const actorId = hand.current_turn_user_id;
    const { data: actorHandPlayer } = await admin
      .from("hand_players")
      .select("committed_this_street")
      .eq("hand_id", hand.id)
      .eq("user_id", actorId)
      .single();
    const toCall = hand.current_bet - actorHandPlayer.committed_this_street;
    const { error } = await invoke(actor, "player-action", {
      handId: hand.id,
      clientActionId: crypto.randomUUID(),
      action: { type: toCall > 0 ? "call" : "check" },
    });
    assert(!error, `player-action failed while finishing hand: ${error?.message}`);
    const { data: refreshed } = await admin.from("hands").select("*").eq("id", hand.id).single();
    hand = refreshed;
  }
  assert(hand.status === "complete", "hand should have completed via check/call");
}
await finishCurrentHand();

// start-hand's catch-up loop fires once per full interval the deadline is
// overdue by, so "1 interval + 30s ago" (i.e. strictly between 1x and 2x
// the interval overdue) lands on exactly 2 catch-up bumps.
const overdueDeadline = new Date(Date.now() - 10 * 60_000 - 30_000).toISOString();
await admin.from("games").update({ next_blind_increase_at: overdueDeadline }).eq("id", game.id);

const { data: start2, error: start2Error } = await invoke(host.client, "start-hand", { gameId: game.id });
assert(!start2Error, `second start-hand failed: ${start2Error?.message}`);

const { data: gameAfterHand2 } = await admin.from("games").select("*").eq("id", game.id).single();
assert(
  gameAfterHand2.small_blind === 40 && gameAfterHand2.big_blind === 80,
  `expected blinds to double twice (10/20 -> 40/80), got ${gameAfterHand2.small_blind}/${gameAfterHand2.big_blind}`,
);
assert(gameAfterHand2.current_blind_level === 2, `expected blind level 2, got ${gameAfterHand2.current_blind_level}`);
assert(
  new Date(gameAfterHand2.next_blind_increase_at).getTime() > Date.now(),
  "next_blind_increase_at should now be back in the future",
);
console.log("PASS: an overdue blind clock catches up correctly (two elapsed intervals -> two doublings)");

// The hand that was just dealt with the bumped blinds should reflect them.
assert(
  start2.hand.pot_total === 40 + 80,
  `expected the new hand's pot to reflect the bumped blinds (120), got ${start2.hand.pot_total}`,
);
console.log("PASS: the hand dealt right after a blind bump actually uses the new blinds");

console.log("\nALL BLIND-INCREASE CHECKS PASSED");
