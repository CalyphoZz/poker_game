// M5 integration check: verifies enforce-turn-timeout (a stalled player gets
// auto-folded once their turn_deadline has passed, but not before) and rebuy
// (only allowed once truly busted, tops back up to the starting stack).
//
// Usage: node scripts/test-timeout-and-rebuy.mjs
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

const { data: createData, error: createError } = await invoke(host.client, "create-game", {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  maxPlayers: 2,
  turnDurationSeconds: 1, // short on purpose, so the timeout test doesn't need to wait long
});
assert(!createError, `create-game failed: ${createError?.message}`);
const game = createData.game;

const { error: joinError } = await invoke(guest.client, "join-game", { inviteCode: game.invite_code });
assert(!joinError, `join-game failed: ${joinError?.message}`);

const { data: startData, error: startError } = await invoke(host.client, "start-hand", { gameId: game.id });
assert(!startError, `start-hand failed: ${startError?.message}`);
const hand = startData.hand;

// It's the dealer's (host's) turn preflop heads-up. Immediately trying to
// enforce a timeout should be a no-op -- the deadline hasn't passed yet.
const { data: tooEarly, error: tooEarlyError } = await invoke(guest.client, "enforce-turn-timeout", {
  handId: hand.id,
});
assert(!tooEarlyError, `enforce-turn-timeout call failed: ${tooEarlyError?.message}`);
assert(tooEarly.message === "Turn has not timed out yet", "should not enforce before the deadline");
console.log("PASS: enforce-turn-timeout is a no-op before the deadline passes");

// Wait past the 1-second turn duration, then enforce -- the stalled dealer
// (facing a call, not a check) should be auto-folded, ending the hand
// uncontested in the guest's favor.
await new Promise((resolve) => setTimeout(resolve, 1500));

const { data: enforced, error: enforceError } = await invoke(guest.client, "enforce-turn-timeout", {
  handId: hand.id,
});
assert(!enforceError, `enforce-turn-timeout failed: ${enforceError?.message}`);
assert(enforced.effectiveActionType === "fold", `expected auto-fold, got ${enforced.effectiveActionType}`);
assert(enforced.status === "complete", "hand should end when the stalled player is auto-folded");
console.log("PASS: a stalled player is auto-folded once their turn_deadline passes");

const { data: playersAfterTimeout } = await host.client
  .from("game_players")
  .select("user_id, stack")
  .eq("game_id", game.id);
const guestStack = playersAfterTimeout.find((p) => p.user_id === guest.userId).stack;
assert(guestStack > 1000, "guest should have won the uncontested pot after host's auto-fold");
console.log("PASS: winner of the auto-folded hand was credited the pot");

// Rebuy should be refused while both players still have chips.
const { error: earlyRebuyError } = await invoke(host.client, "rebuy", { gameId: game.id });
assert(earlyRebuyError, "rebuy should be refused while stack > 0");
console.log("PASS: rebuy is refused while the player still has chips");

// A separate, tiny-stakes game (startingStack === bigBlind) so every hand is
// a coin-flip all-in from the blinds alone -- drives real hands until
// someone actually busts, then exercises rebuy for real. The client has no
// write access to `stack` at all, so busting can't be faked; it has to be
// earned by really losing a hand.
const { data: microGameData, error: microGameError } = await invoke(host.client, "create-game", {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 20,
  maxPlayers: 2,
});
assert(!microGameError, `create-game (micro-stakes) failed: ${microGameError?.message}`);
const microGame = microGameData.game;
const { error: microJoinError } = await invoke(guest.client, "join-game", {
  inviteCode: microGame.invite_code,
});
assert(!microJoinError, `join-game (micro-stakes) failed: ${microJoinError?.message}`);

const clientsByUserId = { [host.userId]: host.client, [guest.userId]: guest.client };
let bustedUserId = null;

for (let i = 0; i < 20 && !bustedUserId; i++) {
  const { data: players } = await host.client
    .from("game_players")
    .select("user_id, stack")
    .eq("game_id", microGame.id);
  const alreadyBusted = players.find((p) => p.stack === 0);
  if (alreadyBusted) {
    bustedUserId = alreadyBusted.user_id;
    break;
  }

  const { data: startNext, error: startNextError } = await invoke(host.client, "start-hand", {
    gameId: microGame.id,
  });
  assert(!startNextError, `start-hand failed: ${startNextError?.message}`);
  let currentHand = startNext.hand;

  // Everyone shoves preflop -- with stacks equal to the big blind, the very
  // first real decision already puts someone all-in, and the engine runs
  // the rest out automatically.
  while (currentHand.status === "in_progress") {
    const actingClient = clientsByUserId[currentHand.current_turn_user_id];
    const toCall = currentHand.current_bet > 0;
    await invoke(actingClient, "player-action", {
      handId: currentHand.id,
      clientActionId: crypto.randomUUID(),
      action: { type: toCall ? "call" : "check" },
    });
    const { data: refreshed } = await host.client.from("hands").select("*").eq("id", currentHand.id).single();
    currentHand = refreshed;
  }
}

assert(bustedUserId, "expected someone to bust within 20 hands with stack === big blind");
console.log("PASS: a player actually busted through real play (stack reached 0)");

const bustedClient = clientsByUserId[bustedUserId];
const { error: rebuyError } = await invoke(bustedClient, "rebuy", { gameId: microGame.id });
assert(!rebuyError, `rebuy failed: ${rebuyError?.message}`);

const { data: afterRebuy } = await host.client
  .from("game_players")
  .select("stack")
  .eq("game_id", microGame.id)
  .eq("user_id", bustedUserId)
  .single();
assert(afterRebuy.stack === 20, `expected rebuy to restore starting stack (20), got ${afterRebuy.stack}`);
console.log("PASS: rebuy restores the busted player to the starting stack");

console.log("\nALL TIMEOUT/REBUY CHECKS PASSED");
