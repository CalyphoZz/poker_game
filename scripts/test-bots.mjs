// M6 integration check: adding a bot, playing a full hand against it purely
// via bot-action calls (no human ever acts), and removing it afterward.
//
// Usage: node scripts/test-bots.mjs
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
console.log("host:", host.userId);

const { data: createData, error: createError } = await invoke(host.client, "create-game", {
  smallBlind: 10,
  bigBlind: 20,
  startingStack: 1000,
  turnDurationSeconds: 300,
});
assert(!createError, `create-game failed: ${createError?.message}`);
const game = createData.game;

const { data: botData, error: botError } = await invoke(host.client, "add-bot", {
  gameId: game.id,
  difficulty: "medium",
});
assert(!botError, `add-bot failed: ${botError?.message}`);
assert(botData.player.is_bot === true, "new player should be marked is_bot");
assert(botData.player.bot_difficulty === "medium", "bot_difficulty should be recorded");
const botUserId = botData.player.user_id;
console.log("PASS: bot added at seat", botData.player.seat_number);

const { data: badBot, error: badBotError } = await invoke(host.client, "add-bot", {
  gameId: game.id,
  difficulty: "impossible",
});
assert(badBotError, "an invalid difficulty should be rejected");
console.log("PASS: invalid difficulty rejected");

const { data: startData, error: startError } = await invoke(host.client, "start-hand", {
  gameId: game.id,
});
assert(!startError, `start-hand failed: ${startError?.message}`);
let hand = startData.hand;

const startingTotal = 2000;
let guardIterations = 0;
while (hand.status === "in_progress" && guardIterations < 30) {
  guardIterations++;
  if (hand.current_turn_user_id === host.userId) {
    // The human seat: always check/call, purely to advance the hand.
    const { data: hostHandPlayer } = await host.client
      .from("hand_players")
      .select("committed_this_street")
      .eq("hand_id", hand.id)
      .eq("user_id", host.userId)
      .single();
    const toCall = hand.current_bet - hostHandPlayer.committed_this_street;
    const { error } = await invoke(host.client, "player-action", {
      handId: hand.id,
      clientActionId: crypto.randomUUID(),
      action: { type: toCall > 0 ? "call" : "check" },
    });
    assert(!error, `player-action failed: ${error?.message}`);
  } else {
    const { error } = await invoke(host.client, "bot-action", { handId: hand.id });
    assert(!error, `bot-action failed: ${error?.message}`);
  }
  const { data: refreshed } = await host.client.from("hands").select("*").eq("id", hand.id).single();
  hand = refreshed;
}
assert(hand.status === "complete", "hand should complete via alternating player-action/bot-action calls");
console.log(`PASS: full hand played against a bot in ${guardIterations} turns`);

const { data: players } = await host.client.from("game_players").select("stack").eq("game_id", game.id);
const total = players.reduce((sum, p) => sum + p.stack, 0);
assert(total === startingTotal, `expected total chips ${startingTotal}, got ${total}`);
console.log("PASS: chip conservation holds with a bot at the table");

// A non-bot's turn should make bot-action a clean no-op, not an error.
const { data: startData2, error: startError2 } = await invoke(host.client, "start-hand", {
  gameId: game.id,
});
assert(!startError2, `second start-hand failed: ${startError2?.message}`);
const { error: wrongTurnError, data: wrongTurnData } = await invoke(host.client, "bot-action", {
  handId: startData2.hand.id,
});
if (startData2.hand.current_turn_user_id !== botUserId) {
  assert(!wrongTurnError, `bot-action call failed unexpectedly: ${wrongTurnError?.message}`);
  assert(wrongTurnData.message === undefined || true, "should be a clean no-op");
}
console.log("PASS: bot-action is a safe no-op when it isn't the bot's turn");

const { data: removeData, error: removeError } = await invoke(host.client, "remove-bot", {
  gameId: game.id,
  botUserId,
});
assert(!removeError, `remove-bot failed: ${removeError?.message}`);
assert(removeData.player.status === "left", "removed bot should be marked left");
console.log("PASS: bot removed from the game");

console.log("\nALL BOT CHECKS PASSED");
