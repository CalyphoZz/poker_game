// M3 integration check: plays one full heads-up hand start-to-finish through
// raw start-hand/player-action HTTP calls -- no UI involved -- verifying the
// wiring between the pure poker-engine package and the real local Supabase
// stack (Postgres + Auth + Edge Functions).
//
// Usage: node scripts/test-full-hand.mjs
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
  if (error || !data.session) throw error ?? new Error("signInAnonymously returned no session");
  return { client, userId: data.user.id };
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function invoke(client, fn, body) {
  return client.functions.invoke(fn, { body });
}

const host = await signInAnon();
const guest = await signInAnon();
console.log("host:", host.userId, "guest:", guest.userId);

const { data: createData, error: createError } = await invoke(host.client, "create-game", {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  maxPlayers: 2,
});
assert(!createError, `create-game failed: ${createError?.message}`);
const game = createData.game;
console.log("game:", game.invite_code);

const { error: joinError } = await invoke(guest.client, "join-game", { inviteCode: game.invite_code });
assert(!joinError, `join-game failed: ${joinError?.message}`);

const { data: startData, error: startError } = await invoke(host.client, "start-hand", {
  gameId: game.id,
});
assert(!startError, `start-hand failed: ${startError?.message}`);
let hand = startData.hand;
console.log("hand started, dealer_seat:", hand.dealer_seat, "status:", hand.status);
assert(hand.status === "in_progress", "hand should be in_progress after start-hand");

const clientsByUserId = { [host.userId]: host.client, [guest.userId]: guest.client };

// Verify hole-card secrecy before any showdown: each player can read only
// their own cards, and cannot read the other's.
async function fetchOwnHoleCards(client, userId) {
  const { data } = await client
    .from("hand_hole_cards")
    .select("user_id, cards")
    .eq("hand_id", hand.id);
  return data;
}

const hostCardsView = await fetchOwnHoleCards(host.client, host.userId);
assert(hostCardsView.length === 1 && hostCardsView[0].user_id === host.userId, "host should see only their own hole cards while hand is in progress");
const guestCardsView = await fetchOwnHoleCards(guest.client, guest.userId);
assert(guestCardsView.length === 1 && guestCardsView[0].user_id === guest.userId, "guest should see only their own hole cards while hand is in progress");
console.log("PASS: hole card secrecy holds mid-hand (each player sees only their own)");

async function refetchHand() {
  const { data } = await host.client.from("hands").select("*").eq("id", hand.id).single();
  hand = data;
  return hand;
}

async function act(action) {
  const actingUserId = hand.current_turn_user_id;
  const client = clientsByUserId[actingUserId];
  const { data, error } = await invoke(client, "player-action", {
    handId: hand.id,
    clientActionId: crypto.randomUUID(),
    action,
  });
  assert(!error, `player-action (${action.type} by ${actingUserId}) failed: ${error?.message}`);
  await refetchHand();
  return data;
}

// Preflop: dealer (host, heads-up SB) calls, guest (BB) checks -> flop.
assert(hand.current_turn_user_id === host.userId, "dealer should act first preflop heads-up");
await act({ type: "call" });
assert(hand.current_street === "preflop", "still preflop after the call");
await act({ type: "check" });
assert(hand.current_street === "flop", "should advance to flop after both act");
assert(hand.current_turn_user_id === guest.userId, "non-dealer should act first postflop heads-up");

// Flop, turn, river: both check each street.
for (const expectedStreet of ["flop", "turn", "river"]) {
  assert(hand.current_street === expectedStreet, `expected street ${expectedStreet}, got ${hand.current_street}`);
  await act({ type: "check" });
  await act({ type: "check" });
}

assert(hand.status === "complete", "hand should be complete after river action closes");
console.log("PASS: full heads-up hand played to completion via raw Edge Function calls");

// Post-showdown: hole cards become visible to all hand members.
const hostViewOfAll = await fetchOwnHoleCards(host.client, host.userId);
assert(hostViewOfAll.length === 2, "hole cards should be visible to everyone once the hand is complete");
console.log("PASS: hole cards reveal to all hand members after showdown");

// Chip conservation across the whole hand: stacks should sum back to 2000.
const { data: finalPlayers } = await host.client
  .from("game_players")
  .select("stack")
  .eq("game_id", game.id);
const total = finalPlayers.reduce((sum, p) => sum + p.stack, 0);
assert(total === 2000, `expected total chips 2000, got ${total}`);
console.log("PASS: chip conservation holds (total stack still 2000)");

// Acting out of turn must be rejected, not silently accepted.
{
  const notActingClient = clientsByUserId[hand.current_turn_user_id === host.userId ? guest.userId : host.userId];
  // Start a second hand first so there is a live turn to violate.
  const { data: secondStart, error: secondStartError } = await invoke(host.client, "start-hand", {
    gameId: game.id,
  });
  assert(!secondStartError, `second start-hand failed: ${secondStartError?.message}`);
  hand = secondStart.hand;
  assert(hand.hand_number === 2, "hand_number should increment");

  // Dealer rotates: hand 1's dealer was host (seat 1) -> hand 2's dealer
  // should be guest (seat 2).
  const { data: guestSeat } = await host.client
    .from("game_players")
    .select("seat_number")
    .eq("game_id", game.id)
    .eq("user_id", guest.userId)
    .single();
  assert(hand.dealer_seat === guestSeat.seat_number, "dealer should rotate to the other seat");
  console.log("PASS: dealer rotates to the other seat on the next hand");

  const wrongClient = clientsByUserId[hand.current_turn_user_id];
  const otherClient = wrongClient === host.client ? guest.client : host.client;
  const { error: outOfTurnError } = await invoke(otherClient, "player-action", {
    handId: hand.id,
    clientActionId: crypto.randomUUID(),
    action: { type: "fold" },
  });
  assert(outOfTurnError, "acting out of turn should be rejected");
  console.log("PASS: acting out of turn is rejected");
}

// Raise then fold: pot should go entirely to the raiser, uncontested.
{
  const stacksBefore = await host.client.from("game_players").select("user_id, stack").eq("game_id", game.id);
  const raiserId = hand.current_turn_user_id;
  const raiser = clientsByUserId[raiserId];
  const folderId = raiserId === host.userId ? guest.userId : host.userId;
  const folder = clientsByUserId[folderId];

  await invoke(raiser, "player-action", {
    handId: hand.id,
    clientActionId: crypto.randomUUID(),
    action: { type: "raise", amount: 60 },
  });
  await refetchHand();
  assert(hand.current_bet === 60, "current_bet should reflect the raise");

  await invoke(folder, "player-action", {
    handId: hand.id,
    clientActionId: crypto.randomUUID(),
    action: { type: "fold" },
  });
  await refetchHand();
  assert(hand.status === "complete", "hand should end immediately when one player folds");

  const { data: stacksAfter } = await host.client.from("game_players").select("user_id, stack").eq("game_id", game.id);
  const raiserBefore = stacksBefore.data.find((p) => p.user_id === raiserId).stack;
  const raiserAfter = stacksAfter.find((p) => p.user_id === raiserId).stack;
  assert(raiserAfter > raiserBefore, "the raiser should have won the pot after the fold");

  const totalAfterHandTwo = stacksAfter.reduce((sum, p) => sum + p.stack, 0);
  assert(totalAfterHandTwo === 2000, `expected total chips still 2000, got ${totalAfterHandTwo}`);
  console.log("PASS: raise + fold resolves correctly, chips still conserved");
}

console.log("\nALL FULL-HAND CHECKS PASSED");
