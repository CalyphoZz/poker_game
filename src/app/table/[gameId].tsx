import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { evaluateHand } from 'poker-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FloatingWinText } from '@/components/floating-win-text';
import { PlayingCard } from '@/components/playing-card';
import { TableFelt } from '@/components/table-felt';
import { ThemedText } from '@/components/themed-text';
import { TimerRing } from '@/components/timer-ring';
import { Spacing } from '@/constants/theme';
import { getAvatarEmoji } from '@/lib/avatarEmoji';
import { generateClientActionId } from '@/lib/clientActionId';
import { supabase } from '@/lib/supabase';

interface HandRow {
  id: string;
  hand_number: number;
  status: string;
  current_street: string;
  board_cards: string[];
  pot_total: number;
  current_bet: number;
  min_raise: number;
  current_turn_user_id: string | null;
  turn_deadline: string | null;
  dealer_seat: number;
  winners: { potIndex: number; amount: number; winnerIds: string[]; amounts: Record<string, number> }[] | null;
}

interface HandPlayerRow {
  id: string;
  user_id: string;
  seat_number: number;
  stack: number;
  committed_this_street: number;
  committed_total: number;
  is_folded: boolean;
  is_all_in: boolean;
  final_stack: number | null;
  profiles: { display_name: string } | null;
}

interface HandActionRow {
  id: string;
  user_id: string;
  street: string;
  action_type: string;
  amount: number;
  sequence_number: number;
}

const FELT_EDGE = '#0a3521';
const GOLD = '#f5c942';
const GREEN = '#3ddc84';
const RED = '#c0392b';
// The table screen is a dedicated dark "game" surface, fixed regardless of
// the rest of the app's light/dark system theme -- matching how poker/casino
// apps look, and because white game-felt text needs a dark surround to stay
// readable no matter what theme the phone is set to.
const DARK_BG = '#10141a';
const DARK_SURFACE = '#1b212b';
const TEXT_LIGHT = '#ffffff';
const TEXT_MUTED = '#9aa4b0';

// The mockup mixes English poker shorthand with French for the raise action
// specifically ("RELANCE") -- kept verbatim rather than fully translating,
// since that's literally what was asked to match.
const ACTION_BADGE_LABEL: Record<string, string> = {
  post_sb: 'SB',
  post_bb: 'BB',
  fold: 'FOLD',
  check: 'CHECK',
  call: 'CALL',
  raise: 'RELANCE',
  all_in: 'ALL-IN',
};
const RAISE_TYPES = new Set(['raise', 'all_in']);

const AUTO_NEXT_HAND_DELAY_MS = 3200;
const SEAT_MAX_WIDTH = 92;
// A mobile screen (portrait or landscape) is never tall/wide enough to place
// opponents at fixed pixel coordinates and guarantee they never collide with
// the board -- a real flexbox layout (opponents wrap naturally, the board
// takes whatever space is left in the middle, "me" sits at the bottom)
// adapts to any screen size instead of needing hand-tuned constants per
// device, which is the whole point of "responsive".

export default function TableScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [gameTurnDuration, setGameTurnDuration] = useState<number | null>(null);
  const [blinds, setBlinds] = useState<{ small: number; big: number } | null>(null);
  const [botUserIds, setBotUserIds] = useState<Set<string>>(new Set());
  const [hand, setHand] = useState<HandRow | null>(null);
  const [handPlayers, setHandPlayers] = useState<HandPlayerRow[]>([]);
  const [holeCards, setHoleCards] = useState<Record<string, [string, string]>>({});
  const [actions, setActions] = useState<HandActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [sliderResetKey, setSliderResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingNext, setStartingNext] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [rebuying, setRebuying] = useState(false);
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const [gamePlayers, setGamePlayers] = useState<{ user_id: string; stack: number; status: string }[]>([]);
  const [gameOverDismissedFor, setGameOverDismissedFor] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chipFlightVisible, setChipFlightVisible] = useState(false);
  const timeoutCalledForRef = useRef<string | null>(null);
  const botActionCalledForRef = useRef<string | null>(null);
  const autoNextCalledForRef = useRef<string | null>(null);
  const chipFlightPlayedForRef = useRef<string | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const potPulse = useRef(new Animated.Value(1)).current;
  const chipFlight = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const previousPotRef = useRef(0);

  const refreshHandPlayers = useCallback(async (handId: string) => {
    const { data } = await supabase
      .from('hand_players')
      .select(
        'id, user_id, seat_number, stack, committed_this_street, committed_total, is_folded, is_all_in, final_stack, profiles(display_name)',
      )
      .eq('hand_id', handId)
      .order('seat_number', { ascending: true });
    setHandPlayers((data as unknown as HandPlayerRow[]) ?? []);
  }, []);

  const refreshHoleCards = useCallback(async (handId: string) => {
    const { data } = await supabase.from('hand_hole_cards').select('user_id, cards').eq('hand_id', handId);
    const next: Record<string, [string, string]> = {};
    for (const row of data ?? []) {
      next[row.user_id] = row.cards as [string, string];
    }
    setHoleCards(next);
  }, []);

  // Live stacks for the whole game (not just this hand) -- needed to know
  // whether the game can actually continue: hand_players.stack is a
  // snapshot frozen at the moment THIS hand ended, so it goes stale the
  // instant someone rebuys, which is exactly the moment that matters here.
  const refreshGamePlayers = useCallback(async () => {
    const { data } = await supabase
      .from('game_players')
      .select('user_id, stack, status')
      .eq('game_id', gameId);
    setGamePlayers(data ?? []);
  }, [gameId]);

  const refreshActions = useCallback(async (handId: string) => {
    const { data } = await supabase
      .from('hand_actions')
      .select('id, user_id, street, action_type, amount, sequence_number')
      .eq('hand_id', handId)
      .order('sequence_number', { ascending: true });
    setActions(data ?? []);
  }, []);

  // Load the current hand for this game, and keep it live via Realtime.
  useEffect(() => {
    let isMounted = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (isMounted) setMyUserId(user?.id ?? null);

      const { data: game } = await supabase
        .from('games')
        .select('turn_duration_seconds, small_blind, big_blind')
        .eq('id', gameId)
        .single();
      if (isMounted) setGameTurnDuration(game?.turn_duration_seconds ?? null);
      if (isMounted && game) setBlinds({ small: game.small_blind, big: game.big_blind });

      const { data: botPlayers } = await supabase
        .from('game_players')
        .select('user_id')
        .eq('game_id', gameId)
        .eq('is_bot', true);
      if (isMounted) setBotUserIds(new Set((botPlayers ?? []).map((p) => p.user_id)));

      await refreshGamePlayers();

      const { data: latestHand } = await supabase
        .from('hands')
        .select('*')
        .eq('game_id', gameId)
        .order('hand_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestHand) {
        router.replace(`/lobby/${gameId}`);
        return;
      }
      if (isMounted) setHand(latestHand);
      if (isMounted) setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`table-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hands', filter: `game_id=eq.${gameId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          setHand(payload.new as HandRow);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          const updated = payload.new as { small_blind: number; big_blind: number };
          setBlinds({ small: updated.small_blind, big: updated.big_blind });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => refreshGamePlayers(),
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [gameId, refreshGamePlayers]);

  // Whenever the current hand id changes, (re)subscribe to its players/
  // actions and fetch hole cards fresh (never delivered over Realtime).
  useEffect(() => {
    if (!hand) return;
    const handId = hand.id;

    refreshHandPlayers(handId);
    refreshHoleCards(handId);
    refreshActions(handId);

    const channel = supabase
      .channel(`hand-${handId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hand_players', filter: `hand_id=eq.${handId}` },
        () => refreshHandPlayers(handId),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hand_actions', filter: `hand_id=eq.${handId}` },
        () => refreshActions(handId),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.id]);

  // Hole cards become visible to everyone once the hand completes -- the
  // initial fetch above only ran once for this hand id and would have been
  // RLS-limited to just my own cards while it was in progress.
  useEffect(() => {
    if (hand?.status === 'complete') {
      refreshHoleCards(hand.id);
    }
  }, [hand?.status, hand?.id, refreshHoleCards]);

  // Client-side countdown, driven by the server's turn_deadline. When it
  // reaches zero, any client (not just the stalled player's own) nudges the
  // server via enforce-turn-timeout -- a no-op unless the deadline has
  // genuinely passed there too, see architecture plan section 3.
  useEffect(() => {
    if (!hand || hand.status !== 'in_progress' || !hand.turn_deadline) {
      setSecondsLeft(null);
      return;
    }
    const deadline = new Date(hand.turn_deadline).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && timeoutCalledForRef.current !== hand.id + hand.turn_deadline) {
        timeoutCalledForRef.current = hand.id + hand.turn_deadline;
        supabase.functions.invoke('enforce-turn-timeout', { body: { handId: hand.id } });
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hand?.id, hand?.status, hand?.turn_deadline]);

  // Bots don't have a human sitting at a screen to press buttons, so any
  // connected client nudges the server the moment it observes a bot's turn
  // -- same "any client can trigger it, server no-ops if it's wrong" pattern
  // as enforce-turn-timeout. A short delay makes the bot feel like it's
  // "thinking" instead of instant, and the ref guard stops every client from
  // firing the same call redundantly on each Realtime update.
  useEffect(() => {
    if (!hand || hand.status !== 'in_progress' || !hand.current_turn_user_id) return;
    if (!botUserIds.has(hand.current_turn_user_id)) return;
    // actions.length strictly increases by exactly one every time the turn
    // advances (including the bot's own prior actions), so it uniquely
    // identifies "it's this bot's turn after N actions" -- unlike pot_total,
    // which can repeat across streets when nobody has bet yet (e.g. a check
    // round), which would otherwise block a legitimate later call.
    const key = `${hand.id}-${hand.current_turn_user_id}-${actions.length}`;
    if (botActionCalledForRef.current === key) return;
    botActionCalledForRef.current = key;

    const timeout = setTimeout(() => {
      supabase.functions.invoke('bot-action', { body: { handId: hand.id } });
    }, 900);
    return () => clearTimeout(timeout);
  }, [hand?.id, hand?.status, hand?.current_turn_user_id, botUserIds, actions.length]);

  // A gentle pulse on whoever's turn it is -- cheap "something needs your
  // attention" feedback without a full animation library.
  useEffect(() => {
    if (!hand || hand.status !== 'in_progress') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hand?.current_turn_user_id, hand?.status, pulse]);

  // A quick bounce on the pot pill whenever it grows -- stands in for a full
  // chip-flying animation as a lightweight "money moved" cue.
  useEffect(() => {
    if (!hand) return;
    if (hand.pot_total > previousPotRef.current) {
      potPulse.setValue(1.3);
      Animated.spring(potPulse, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
    }
    previousPotRef.current = hand.pot_total;
  }, [hand?.pot_total, potPulse]);

  const me = handPlayers.find((p) => p.user_id === myUserId);
  const myCards = myUserId ? holeCards[myUserId] : undefined;
  const opponents = handPlayers.filter((p) => p.user_id !== myUserId);

  const bestHand = useMemo(() => {
    if (!myCards || !hand || hand.board_cards.length < 3) return null;
    return evaluateHand(myCards, hand.board_cards);
  }, [myCards, hand]);

  const winnerIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const pot of hand?.winners ?? []) {
      for (const id of pot.winnerIds) ids.add(id);
    }
    return ids;
  }, [hand?.winners]);

  // Summed per player across every pot (a side-pot hand can have the same
  // player win more than one pot) -- feeds the FloatingWinText next to each
  // winning seat.
  const winningsByUserId = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const pot of hand?.winners ?? []) {
      for (const winnerId of pot.winnerIds) {
        totals[winnerId] = (totals[winnerId] ?? 0) + (pot.amounts[winnerId] ?? 0);
      }
    }
    return totals;
  }, [hand?.winners]);

  // Each seat shows its own small action badge (FOLD/CHECK/CALL/RELANCE)
  // instead of one global "last action" line -- only for the CURRENT street,
  // since a check from three streets ago shouldn't still be showing.
  const actionByUserThisStreet = useMemo(() => {
    const map: Record<string, HandActionRow> = {};
    for (const a of actions) {
      if (a.street !== hand?.current_street) continue;
      map[a.user_id] = a;
    }
    return map;
  }, [actions, hand?.current_street]);

  // Chips visually drift from the pot toward the winner's side of the table
  // (up toward the opponents, or down toward "me") the moment a hand
  // resolves -- a coarse directional cue rather than a pixel-precise one,
  // since seats are laid out by flexbox now (no fixed coordinates to target).
  // The precise "who won how much" signal is the FloatingWinText next to
  // their name.
  useEffect(() => {
    if (!hand || hand.status !== 'complete' || !hand.winners?.length) return;
    if (chipFlightPlayedForRef.current === hand.id) return;
    chipFlightPlayedForRef.current = hand.id;

    const winnerId = hand.winners[0].winnerIds[0];
    const winnerIsMe = winnerId === myUserId;

    chipFlight.setValue({ x: 0, y: 0 });
    setChipFlightVisible(true);
    Animated.timing(chipFlight, {
      toValue: { x: 0, y: winnerIsMe ? 60 : -60 },
      duration: 700,
      useNativeDriver: true,
    }).start(() => setChipFlightVisible(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.status, hand?.id]);

  // The next hand starts on its own a couple of seconds after this one
  // resolves -- long enough to see the reveal/chip animation, short enough
  // that nobody has to sit around clicking "next hand" between rounds. But
  // only while at least 2 players actually have chips to play with --
  // otherwise start-hand would just reject it every time (see the
  // "Partie terminée" branch below), so there's no point auto-retrying.
  useEffect(() => {
    const playersWithChipsNow = gamePlayers.filter((p) => p.status !== 'left' && p.stack > 0).length;
    if (!hand || hand.status !== 'complete' || playersWithChipsNow < 2) {
      setNextHandCountdown(null);
      return;
    }
    if (autoNextCalledForRef.current === hand.id) return;

    const startedAt = Date.now();
    const tick = () => {
      const remainingMs = AUTO_NEXT_HAND_DELAY_MS - (Date.now() - startedAt);
      setNextHandCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    };
    tick();
    const interval = setInterval(tick, 250);

    const timeout = setTimeout(() => {
      if (autoNextCalledForRef.current !== hand.id) {
        autoNextCalledForRef.current = hand.id;
        supabase.functions.invoke('start-hand', { body: { gameId } });
      }
    }, AUTO_NEXT_HAND_DELAY_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [hand?.status, hand?.id, gameId, gamePlayers]);

  const isMyTurn = hand?.status === 'in_progress' && hand.current_turn_user_id === myUserId;
  const turnProgress =
    secondsLeft !== null && gameTurnDuration ? secondsLeft / gameTurnDuration : 1;
  const toCall = hand && me ? hand.current_bet - me.committed_this_street : 0;
  const minRaiseTarget = hand ? hand.current_bet + hand.min_raise : 0;
  const maxRaiseTarget = me ? me.stack + me.committed_this_street : 0;

  // The slider is an uncontrolled component (its `value` prop is only read
  // once, on mount) so nudging raiseAmount from a quick-bet button has to
  // force a remount via sliderResetKey to actually move the thumb -- dragging
  // itself never needs this, since RN Slider tracks its own gesture state.
  function setRaiseAmountAndResetSlider(v: number) {
    setRaiseAmount(v);
    setSliderResetKey((k) => k + 1);
  }

  useEffect(() => {
    if (isMyTurn) {
      setRaiseAmountAndResetSlider(Math.min(maxRaiseTarget, minRaiseTarget));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, minRaiseTarget]);

  async function submitAction(type: 'fold' | 'check' | 'call' | 'raise', amount?: number) {
    if (!hand) return;
    setActionError(null);
    setSubmitting(true);
    const { error } = await supabase.functions.invoke('player-action', {
      body: {
        handId: hand.id,
        clientActionId: generateClientActionId(),
        action: { type, amount },
      },
    });
    setSubmitting(false);
    if (error) {
      setActionError(error.message ?? "Cette action n'est pas valide.");
    }
  }

  function clampRaise(target: number): number {
    return Math.min(maxRaiseTarget, Math.max(minRaiseTarget, Math.round(target)));
  }

  function setQuickRaise(fraction: number) {
    const target = hand ? hand.current_bet + toCall + (hand.pot_total + toCall) * fraction : 0;
    setRaiseAmountAndResetSlider(clampRaise(target));
  }

  const raiseStep = Math.max(1, Math.round((maxRaiseTarget - minRaiseTarget) / 100));

  async function handleStartNext() {
    if (hand) autoNextCalledForRef.current = hand.id;
    setStartingNext(true);
    await supabase.functions.invoke('start-hand', { body: { gameId } });
    setStartingNext(false);
  }

  async function handleRebuy() {
    setRebuying(true);
    await supabase.functions.invoke('rebuy', { body: { gameId } });
    setRebuying(false);
  }

  async function handleLeaveGame() {
    setLeaving(true);
    await supabase.functions.invoke('leave-game', { body: { gameId } });
    setLeaving(false);
    router.replace('/');
  }

  // How many players could still deal a next hand right now -- hand_players
  // is a per-hand snapshot that goes stale the moment someone rebuys, so
  // this reads the live game_players stacks instead (see refreshGamePlayers).
  const playersWithChips = gamePlayers.filter((p) => p.status !== 'left' && p.stack > 0).length;
  const isGameOver = hand?.status === 'complete' && playersWithChips < 2;

  if (loading || !hand) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={[styles.safeArea, styles.centered]}>
          <ActivityIndicator color={TEXT_LIGHT} />
        </SafeAreaView>
      </View>
    );
  }

  function renderSeat(player: HandPlayerRow, key: string) {
    const isActing = player.user_id === hand!.current_turn_user_id && hand!.status === 'in_progress';
    const isWinner = hand!.status === 'complete' && winnerIdSet.has(player.user_id);
    const isMe = player.user_id === myUserId;
    const emoji = getAvatarEmoji(player.profiles?.display_name);
    const action = actionByUserThisStreet[player.user_id];
    const revealedCards = hand!.status === 'complete' ? holeCards[player.user_id] : undefined;
    const showFaceDown = !isMe && !player.is_folded && hand!.status === 'in_progress' && !revealedCards;
    const winAmount = winningsByUserId[player.user_id] ?? 0;

    return (
      <Animated.View
        key={key}
        style={[
          styles.seat,
          isActing && { transform: [{ scale: pulse.interpolate({ inputRange: [0.4, 1], outputRange: [1.05, 1] }) }] },
        ]}>
        <View style={styles.seatCardsRow}>
          {isMe && myCards
            ? myCards.map((c, i) => <PlayingCard key={i} card={c} size="medium" />)
            : revealedCards
              ? revealedCards.map((c, i) => <PlayingCard key={i} card={c} size="small" />)
              : showFaceDown && (
                  <>
                    <View style={[styles.faceDownCard, styles.faceDownCardOffset]} />
                    <View style={styles.faceDownCard} />
                  </>
                )}
        </View>

        <View style={styles.avatarWrap}>
          {isActing && (
            <View style={[styles.timerRingBox, isMe && styles.timerRingBoxMe]}>
              <TimerRing size={isMe ? 54 : 46} strokeWidth={3} color={GREEN} progress={turnProgress} />
            </View>
          )}
          <View style={[styles.avatar, isMe && styles.avatarMe, isWinner && styles.avatarWinner]}>
            <ThemedText style={styles.avatarEmoji}>
              {emoji ?? (player.profiles?.display_name ?? '?').slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
          {player.seat_number === hand!.dealer_seat && (
            <View style={styles.dealerDisc}>
              <ThemedText style={styles.dealerDiscText}>D</ThemedText>
            </View>
          )}
          <FloatingWinText amount={winAmount} triggerKey={hand!.id} />
        </View>

        <View style={styles.namePill}>
          <ThemedText numberOfLines={1} style={[styles.namePillText, isWinner && styles.namePillTextWinner]}>
            {isMe ? 'Moi' : (player.profiles?.display_name ?? 'Joueur')}
            {isWinner ? ' 🏆' : ''}
          </ThemedText>
          <ThemedText style={styles.namePillStack}>{player.stack}</ThemedText>
        </View>

        {player.is_all_in ? (
          <View style={styles.allInBadge}>
            <ThemedText style={styles.allInBadgeText}>ALL-IN</ThemedText>
          </View>
        ) : action && hand!.status === 'in_progress' ? (
          <View
            style={[
              styles.actionBadge,
              action.action_type === 'fold' && styles.actionBadgeFold,
              RAISE_TYPES.has(action.action_type) && styles.actionBadgeRaise,
            ]}>
            <ThemedText style={styles.actionBadgeText}>
              {ACTION_BADGE_LABEL[action.action_type]}
              {player.committed_this_street > 0 ? ` ${player.committed_this_street}` : ''}
            </ThemedText>
          </View>
        ) : player.committed_this_street > 0 ? (
          <View style={styles.betChip}>
            <ThemedText style={styles.betChipText}>● {player.committed_this_street}</ThemedText>
          </View>
        ) : null}
        {isMe && bestHand && (
          <ThemedText type="small" style={styles.myHandDescr}>
            {bestHand.descr}
          </ThemedText>
        )}
      </Animated.View>
    );
  }

  const stepper = (
    <View style={styles.stepperRow}>
      <Pressable
        onPress={() => setRaiseAmountAndResetSlider(clampRaise(raiseAmount - raiseStep))}
        disabled={!isMyTurn || submitting}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}>
        <ThemedText style={styles.stepperButtonText}>−</ThemedText>
      </Pressable>
      <View style={styles.amountBox}>
        <ThemedText style={styles.amountBoxText}>{raiseAmount}</ThemedText>
      </View>
      <Pressable
        onPress={() => setRaiseAmountAndResetSlider(clampRaise(raiseAmount + raiseStep))}
        disabled={!isMyTurn || submitting}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}>
        <ThemedText style={styles.stepperButtonText}>+</ThemedText>
      </Pressable>
    </View>
  );

  const sliderEl = (
    <Slider
      key={sliderResetKey}
      style={styles.slider}
      minimumValue={minRaiseTarget}
      maximumValue={Math.max(maxRaiseTarget, minRaiseTarget)}
      step={raiseStep}
      value={raiseAmount}
      onValueChange={setRaiseAmount}
      disabled={!isMyTurn || submitting}
      minimumTrackTintColor={RED}
      maximumTrackTintColor={DARK_SURFACE}
      thumbTintColor={RED}
    />
  );

  const presetsEl = (
    <View style={styles.presetRow}>
      <PresetChip label="Min" onPress={() => setRaiseAmountAndResetSlider(clampRaise(minRaiseTarget))} />
      <PresetChip label="1/2 Pot" onPress={() => setQuickRaise(0.5)} />
      <PresetChip label="Pot" onPress={() => setQuickRaise(1)} />
      <PresetChip label="Max" onPress={() => setRaiseAmountAndResetSlider(clampRaise(maxRaiseTarget))} />
    </View>
  );

  const foldButton = (
    <Pressable
      onPress={() => submitAction('fold')}
      disabled={!isMyTurn || submitting}
      style={({ pressed }) => [
        styles.button,
        styles.foldButton,
        isLandscape && styles.actionButtonLandscape,
        (pressed || !isMyTurn || submitting) && styles.pressed,
      ]}>
      <ThemedText style={styles.foldButtonText}>FOLD</ThemedText>
    </Pressable>
  );

  const callButton = (
    <Pressable
      onPress={() => submitAction(toCall > 0 ? 'call' : 'check')}
      disabled={!isMyTurn || submitting}
      style={({ pressed }) => [
        styles.button,
        styles.callButton,
        isLandscape && styles.actionButtonLandscape,
        (pressed || !isMyTurn || submitting) && styles.pressed,
      ]}>
      <ThemedText style={styles.callButtonText}>{toCall > 0 ? `CALL ${toCall}` : 'CHECK'}</ThemedText>
    </Pressable>
  );

  const raiseButtonEl = (
    <Pressable
      onPress={() => submitAction('raise', clampRaise(raiseAmount))}
      disabled={!isMyTurn || submitting}
      style={({ pressed }) => [
        styles.raiseButton,
        isLandscape && styles.actionButtonLandscape,
        (pressed || !isMyTurn || submitting) && styles.pressed,
      ]}>
      <ThemedText style={styles.raiseButtonText}>
        {clampRaise(raiseAmount) === maxRaiseTarget ? 'ALL-IN' : `RELANCE ${clampRaise(raiseAmount)}`}
      </ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText style={styles.headerTitle}>Main #{hand.hand_number}</ThemedText>
          {blinds && <ThemedText style={styles.headerMuted}>Blindes {blinds.small}/{blinds.big}</ThemedText>}
          <ThemedText style={styles.headerMuted}>{hand.current_street}</ThemedText>
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={8}>
            <ThemedText style={styles.gearIcon}>⚙️</ThemedText>
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.tableWrapper}>
            <View style={styles.table}>
              <TableFelt />
              <View style={styles.centerArea}>
                <ThemedText style={styles.potLabel}>Pot total</ThemedText>
                <Animated.View style={[styles.potPill, { transform: [{ scale: potPulse }] }]}>
                  <ThemedText style={styles.potPillText}>🪙 {hand.pot_total}</ThemedText>
                </Animated.View>
                <View style={styles.boardCards}>
                  {hand.board_cards.map((c, i) => (
                    <PlayingCard key={i} card={c} size="medium" />
                  ))}
                </View>

                {chipFlightVisible && (
                  <Animated.View style={[styles.flyingChip, { transform: chipFlight.getTranslateTransform() }]}>
                    <ThemedText style={styles.flyingChipText}>●</ThemedText>
                  </Animated.View>
                )}
              </View>
            </View>

            {/* Seats sit on their own layer, straddling the felt's top/bottom
                rim rather than floating inside it -- like players actually
                sitting at the rail, not hovering over the green. */}
            <View style={styles.opponentsRow} pointerEvents="box-none">
              {opponents.map((item) => renderSeat(item, item.id))}
            </View>
            <View style={styles.meRow} pointerEvents="box-none">
              {me && renderSeat(me, me.id)}
            </View>
          </View>

          <View style={styles.actionsPanel}>
            {me?.stack === 0 && (
              <Pressable
                onPress={handleRebuy}
                disabled={rebuying}
                style={({ pressed }) => [styles.button, styles.foldButton, (pressed || rebuying) && styles.pressed]}>
                {rebuying ? (
                  <ActivityIndicator color={TEXT_LIGHT} />
                ) : (
                  <ThemedText style={styles.foldButtonText}>Rebuy</ThemedText>
                )}
              </Pressable>
            )}

            {isGameOver && gameOverDismissedFor === hand.id ? null : isGameOver ? (
              <View style={styles.gameOverCard}>
                <ThemedText style={styles.headerTitle}>Partie terminée</ThemedText>
                <ThemedText style={[styles.headerMuted, styles.gameOverText]}>
                  Il ne reste qu&apos;un seul joueur avec des jetons. La partie reprendra si quelqu&apos;un
                  refait un rebuy.
                </ThemedText>
                <View style={styles.gameOverButtons}>
                  <Pressable
                    onPress={() => setGameOverDismissedFor(hand.id)}
                    style={({ pressed }) => [styles.button, styles.foldButton, pressed && styles.pressed]}>
                    <ThemedText style={styles.foldButtonText}>Rester</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={handleLeaveGame}
                    disabled={leaving}
                    style={({ pressed }) => [styles.button, styles.callButton, (pressed || leaving) && styles.pressed]}>
                    {leaving ? (
                      <ActivityIndicator color={TEXT_LIGHT} />
                    ) : (
                      <ThemedText style={styles.callButtonText}>Quitter</ThemedText>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : hand.status === 'complete' ? (
              <Pressable
                onPress={handleStartNext}
                disabled={startingNext}
                style={({ pressed }) => [styles.button, styles.callButton, (pressed || startingNext) && styles.pressed]}>
                {startingNext ? (
                  <ActivityIndicator color={TEXT_LIGHT} />
                ) : (
                  <ThemedText style={styles.callButtonText}>
                    {nextHandCountdown ? `Main suivante dans ${nextHandCountdown}s...` : 'Main suivante'}
                  </ThemedText>
                )}
              </Pressable>
            ) : isLandscape ? (
              <View style={styles.landscapeRow}>
                {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}
                <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.menuIconButton}>
                  <ThemedText style={styles.gearIcon}>⚙️</ThemedText>
                </Pressable>
                {stepper}
                <View style={styles.sliderFlexLandscape}>{sliderEl}</View>
                {foldButton}
                {callButton}
                {raiseButtonEl}
              </View>
            ) : (
              <View style={styles.actionsColumn}>
                {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}
                {stepper}
                {sliderEl}
                {presetsEl}
                <View style={styles.foldCallRow}>
                  {foldButton}
                  {callButton}
                </View>
                {raiseButtonEl}
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>

      <Modal visible={menuOpen} animationType="fade" transparent onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <Pressable
              onPress={handleLeaveGame}
              disabled={leaving}
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
              {leaving ? (
                <ActivityIndicator color={TEXT_LIGHT} />
              ) : (
                <ThemedText style={styles.menuItemTextDanger}>Quitter la partie</ThemedText>
              )}
            </Pressable>
            <Pressable
              onPress={() => setMenuOpen(false)}
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
              <ThemedText style={styles.menuItemText}>Annuler</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function PresetChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.presetChip, pressed && styles.pressed]}>
      <ThemedText style={styles.presetChipText}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  safeArea: {
    flex: 1,
    padding: Spacing.two,
    gap: Spacing.two,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.one,
  },
  headerTitle: {
    color: TEXT_LIGHT,
    fontSize: 14,
    fontWeight: '700',
  },
  headerMuted: {
    color: TEXT_MUTED,
    fontSize: 13,
  },
  gearIcon: {
    fontSize: 18,
  },
  // Portrait: table above, actions below (column). Landscape: side by side
  // (row) so the table can actually become the wide oval it's meant to be --
  // a landscape phone/tablet screen is exactly the aspect ratio that shape
  // needs, which a portrait screen structurally can't provide.
  body: {
    flex: 1,
    gap: Spacing.two,
  },
  // The felt itself is a clipped rounded box containing only the board/pot
  // -- it never competes with the seats for space, which is what let the
  // pot/board collapse to zero height and overlap a seat when content ran
  // tall. Seats live on tableWrapper's own layer instead, free to overlap
  // the felt's rim the way players actually sit at a real table.
  tableWrapper: {
    flex: 1,
    marginTop: Spacing.four,
    marginBottom: Spacing.four,
    position: 'relative',
  },
  table: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 8,
    borderColor: FELT_EDGE,
    borderRadius: Spacing.five,
    overflow: 'hidden',
  },
  opponentsRow: {
    position: 'absolute',
    top: -Spacing.four,
    left: 0,
    right: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  centerArea: {
    flex: 1,
    alignItems: 'center',
    // Explicit top offset instead of justifyContent:'center' -- centering
    // measured as ignoring paddingVertical entirely in this RN-web setup, so
    // it couldn't guarantee clearance from the opponent overlay hanging down
    // into the felt (see opponentsRow's negative top). A flex-start with a
    // hard paddingTop unambiguously starts the pot/board below that reach.
    justifyContent: 'flex-start',
    gap: 2,
    paddingTop: 112,
  },
  potLabel: {
    color: '#ffffff99',
    fontSize: 11,
  },
  boardCards: {
    flexDirection: 'row',
    gap: Spacing.one,
    minHeight: 58,
    marginTop: Spacing.one,
  },
  potPill: {
    backgroundColor: '#00000055',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  potPillText: {
    color: GOLD,
    fontWeight: '700',
    fontSize: 14,
  },
  flyingChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: '#00000055',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flyingChipText: {
    color: '#00000055',
    fontSize: 10,
  },
  seat: {
    maxWidth: SEAT_MAX_WIDTH,
    alignItems: 'center',
  },
  meRow: {
    position: 'absolute',
    bottom: -Spacing.four,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  seatCardsRow: {
    flexDirection: 'row',
    gap: 2,
    minHeight: 20,
    alignItems: 'flex-end',
  },
  faceDownCard: {
    width: 13,
    height: 18,
    borderRadius: 2,
    backgroundColor: '#9c2b2b',
    borderWidth: 1,
    borderColor: '#6e1c1c',
  },
  faceDownCardOffset: {
    marginRight: -5,
    transform: [{ rotate: '-8deg' }],
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  timerRingBox: {
    position: 'absolute',
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRingBoxMe: {
    width: 54,
    height: 54,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3a3f47',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#00000000',
  },
  avatarMe: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarWinner: {
    borderColor: GOLD,
    backgroundColor: '#6b5417',
  },
  avatarEmoji: {
    fontSize: 16,
    color: TEXT_LIGHT,
  },
  dealerDisc: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00000055',
  },
  dealerDiscText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#000',
  },
  namePill: {
    backgroundColor: '#00000088',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    marginTop: -8,
    alignItems: 'center',
    maxWidth: SEAT_MAX_WIDTH + 10,
  },
  namePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  namePillTextWinner: {
    color: GOLD,
  },
  namePillStack: {
    color: GREEN,
    fontSize: 11,
    fontWeight: '700',
  },
  allInBadge: {
    backgroundColor: '#ff6b35',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    marginTop: 2,
  },
  allInBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionBadge: {
    backgroundColor: '#1a1a1acc',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    marginTop: 2,
    alignItems: 'center',
  },
  actionBadgeFold: {
    backgroundColor: '#4a4a4a99',
  },
  actionBadgeRaise: {
    backgroundColor: RED,
  },
  actionBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  betChip: {
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    marginTop: 2,
  },
  betChipText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
  },
  myHandDescr: {
    color: '#cfd3da',
    fontSize: 11,
    marginTop: 2,
  },
  actionsPanel: {
    justifyContent: 'center',
  },
  actionsColumn: {
    gap: Spacing.two,
  },
  // Landscape squeezes everything the mockup shows in one wide row: a
  // settings icon, the stepper, a slider that stretches to fill whatever
  // width is left, then Fold/Call/Raise at fixed widths.
  landscapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  menuIconButton: {
    width: 40,
    height: 40,
    borderRadius: Spacing.two,
    backgroundColor: DARK_SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderFlexLandscape: {
    flex: 1,
  },
  actionButtonLandscape: {
    flex: undefined,
    minWidth: 90,
    paddingHorizontal: Spacing.three,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ffffff33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_LIGHT,
  },
  amountBox: {
    minWidth: 100,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#ffffff33',
    alignItems: 'center',
  },
  amountBoxText: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT_LIGHT,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  presetRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  presetChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ffffff33',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    alignItems: 'center',
  },
  presetChipText: {
    color: TEXT_LIGHT,
    fontSize: 13,
  },
  foldCallRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  raiseButton: {
    backgroundColor: RED,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  raiseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  foldButton: {
    borderWidth: 1,
    borderColor: '#ffffff44',
    backgroundColor: DARK_SURFACE,
  },
  foldButtonText: {
    color: TEXT_LIGHT,
    fontSize: 16,
    fontWeight: '600',
  },
  callButton: {
    backgroundColor: GREEN,
  },
  callButtonText: {
    color: '#06210f',
    fontSize: 16,
    fontWeight: '700',
  },
  error: {
    color: '#ff8a80',
  },
  pressed: {
    opacity: 0.7,
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000aa',
    padding: Spacing.four,
  },
  menuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    backgroundColor: DARK_SURFACE,
  },
  menuItem: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_LIGHT,
  },
  menuItemTextDanger: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff8a80',
  },
  gameOverCard: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  gameOverText: {
    textAlign: 'center',
  },
  gameOverButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
  },
});
