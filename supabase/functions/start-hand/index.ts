import { withSupabase } from "@supabase/server";
import { startNewHand } from "poker-engine";
import { persistHandCompletion } from "../_shared/persistHandCompletion.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const callerUserId = ctx.userClaims!.id;

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

    const admin = ctx.supabaseAdmin;

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

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();
    if (gameError || !game) {
      return Response.json({ message: "Game not found" }, { status: 404 });
    }

    const { data: existingHand } = await admin
      .from("hands")
      .select("id")
      .eq("game_id", gameId)
      .eq("status", "in_progress")
      .maybeSingle();
    if (existingHand) {
      return Response.json({ message: "A hand is already in progress" }, { status: 409 });
    }

    const { data: eligiblePlayers } = await admin
      .from("game_players")
      .select("user_id, seat_number, stack")
      .eq("game_id", gameId)
      .eq("status", "seated")
      .gt("stack", 0)
      .order("seat_number", { ascending: true });

    if (!eligiblePlayers || eligiblePlayers.length < 2) {
      return Response.json({ message: "At least 2 players with chips are required" }, { status: 400 });
    }

    const { data: lastHand } = await admin
      .from("hands")
      .select("hand_number, dealer_user_id")
      .eq("game_id", gameId)
      .order("hand_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const handNumber = (lastHand?.hand_number ?? 0) + 1;
    const previousDealerId = lastHand?.dealer_user_id ?? null;

    const result = startNewHand({
      players: eligiblePlayers.map((p) => ({ id: p.user_id, stack: p.stack })),
      previousDealerId,
      smallBlind: game.small_blind,
      bigBlind: game.big_blind,
    });
    const { state } = result;

    const seatFor = (userId: string) =>
      eligiblePlayers.find((p) => p.user_id === userId)!.seat_number;

    const potTotal = state.players.reduce((sum, p) => sum + p.committedTotal, 0);
    const isStillInProgress = state.status === "in_progress";

    const { data: hand, error: handError } = await admin
      .from("hands")
      .insert({
        game_id: gameId,
        hand_number: handNumber,
        dealer_seat: seatFor(state.players[state.dealerIndex].id),
        small_blind_seat: seatFor(state.players[state.smallBlindIndex].id),
        big_blind_seat: seatFor(state.players[state.bigBlindIndex].id),
        dealer_user_id: state.players[state.dealerIndex].id,
        small_blind_user_id: state.players[state.smallBlindIndex].id,
        big_blind_user_id: state.players[state.bigBlindIndex].id,
        status: state.status,
        current_street: state.street,
        board_cards: state.board,
        pot_total: potTotal,
        current_bet: state.currentBet,
        min_raise: state.minRaise,
        actions_remaining_this_street: state.actionsRemainingThisStreet,
        current_turn_user_id: isStillInProgress ? state.players[state.actingIndex].id : null,
        turn_deadline: isStillInProgress
          ? new Date(Date.now() + game.turn_duration_seconds * 1000).toISOString()
          : null,
        last_aggressor_user_id:
          state.lastAggressorIndex !== null ? state.players[state.lastAggressorIndex].id : null,
      })
      .select()
      .single();

    if (handError || !hand) {
      return Response.json({ message: handError?.message ?? "Failed to start hand" }, { status: 500 });
    }

    await admin.from("hand_players").insert(
      state.players.map((p) => ({
        hand_id: hand.id,
        user_id: p.id,
        seat_number: seatFor(p.id),
        starting_stack: eligiblePlayers.find((ep) => ep.user_id === p.id)!.stack,
        stack: p.stack,
        committed_this_street: p.committedThisStreet,
        committed_total: p.committedTotal,
        is_folded: p.isFolded,
        is_all_in: p.isAllIn,
      })),
    );

    await admin
      .from("hand_deck_state")
      .insert({ hand_id: hand.id, remaining_deck: state.deck });

    await admin.from("hand_hole_cards").insert(
      state.players.map((p) => ({
        hand_id: hand.id,
        user_id: p.id,
        cards: state.holeCards[p.id],
      })),
    );

    const sbPlayer = state.players[state.smallBlindIndex];
    const bbPlayer = state.players[state.bigBlindIndex];

    await admin.from("hand_actions").insert([
      {
        hand_id: hand.id,
        user_id: sbPlayer.id,
        street: "preflop",
        action_type: "post_sb",
        amount: sbPlayer.committedTotal,
        sequence_number: 1,
        client_action_id: crypto.randomUUID(),
      },
      {
        hand_id: hand.id,
        user_id: bbPlayer.id,
        street: "preflop",
        action_type: "post_bb",
        amount: bbPlayer.committedTotal,
        sequence_number: 2,
        client_action_id: crypto.randomUUID(),
      },
    ]);

    await persistHandCompletion(admin, gameId, hand.id, state, result.events);

    return Response.json({ hand }, { status: 201 });
  }),
};
