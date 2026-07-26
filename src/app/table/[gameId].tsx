import { router, useLocalSearchParams } from 'expo-router';
import { evaluateHand } from 'poker-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayingCard } from '@/components/playing-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TimerRing } from '@/components/timer-ring';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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

const FELT = '#0f4a30';
const FELT_EDGE = '#0a3521';
const GOLD = '#f5c942';

const ACTION_LABEL: Record<string, string> = {
  post_sb: 'petite blinde',
  post_bb: 'grosse blinde',
  fold: 'se couche',
  check: 'check',
  call: 'suit',
  raise: 'relance',
  all_in: 'all-in',
};

const OVAL_WIDTH = 380;
const OVAL_HEIGHT = 260;
const SEAT_SIZE = 64;
const SEAT_ROW_TOP = 14;
const AUTO_NEXT_HAND_DELAY_MS = 3200;

// Opponents sit in a single row fixed to the top of the table; the
// center/lower area is reserved entirely for the board + pot so they never
// fight for the same space (a trig-based ellipse placement used to let
// seats drift down into the board's vertical band on tables with 1-2
// opponents -- a fixed row sidesteps that entirely).
function seatPosition(index: number, count: number) {
  const usableWidth = OVAL_WIDTH - 32;
  const spacing = usableWidth / (count + 1);
  const x = 16 + spacing * (index + 1);
  return { left: x - SEAT_SIZE / 2, top: SEAT_ROW_TOP };
}

export default function TableScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const theme = useTheme();

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [gameTurnDuration, setGameTurnDuration] = useState<number | null>(null);
  const [hand, setHand] = useState<HandRow | null>(null);
  const [handPlayers, setHandPlayers] = useState<HandPlayerRow[]>([]);
  const [holeCards, setHoleCards] = useState<Record<string, [string, string]>>({});
  const [actions, setActions] = useState<HandActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [raiseText, setRaiseText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingNext, setStartingNext] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [rebuying, setRebuying] = useState(false);
  const [nextHandCountdown, setNextHandCountdown] = useState<number | null>(null);
  const [chipFlightVisible, setChipFlightVisible] = useState(false);
  const [chipFlightTarget, setChipFlightTarget] = useState({ x: 0, y: 0 });
  const timeoutCalledForRef = useRef<string | null>(null);
  const autoNextCalledForRef = useRef<string | null>(null);
  const chipFlightPlayedForRef = useRef<string | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const potPulse = useRef(new Animated.Value(1)).current;
  const winnerGlow = useRef(new Animated.Value(0)).current;
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
        .select('turn_duration_seconds')
        .eq('id', gameId)
        .single();
      if (isMounted) setGameTurnDuration(game?.turn_duration_seconds ?? null);

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
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

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

  // A glowing pulse around the winner(s) once a hand resolves.
  useEffect(() => {
    if (hand?.status !== 'complete') {
      winnerGlow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(winnerGlow, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(winnerGlow, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hand?.status, winnerGlow]);

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

  // Chips visually fly from the pot to the winner's seat (or toward "my"
  // panel below the table when I win) the moment a hand resolves.
  useEffect(() => {
    if (!hand || hand.status !== 'complete' || !hand.winners?.length) return;
    if (chipFlightPlayedForRef.current === hand.id) return;
    chipFlightPlayedForRef.current = hand.id;

    const winnerId = hand.winners[0].winnerIds[0];
    const oppIndex = opponents.findIndex((o) => o.user_id === winnerId);
    const potOrigin = { x: OVAL_WIDTH / 2, y: SEAT_ROW_TOP + SEAT_SIZE + 62 + 20 };
    const target =
      oppIndex !== -1
        ? (() => {
            const pos = seatPosition(oppIndex, opponents.length);
            return { x: pos.left + SEAT_SIZE / 2, y: pos.top + SEAT_SIZE / 2 };
          })()
        : { x: OVAL_WIDTH / 2, y: OVAL_HEIGHT + 20 };

    setChipFlightTarget(potOrigin);
    chipFlight.setValue({ x: 0, y: 0 });
    setChipFlightVisible(true);
    Animated.timing(chipFlight, {
      toValue: { x: target.x - potOrigin.x, y: target.y - potOrigin.y },
      duration: 900,
      useNativeDriver: true,
    }).start(() => setChipFlightVisible(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.status, hand?.id]);

  // The next hand starts on its own a couple of seconds after this one
  // resolves -- long enough to see the reveal/chip animation, short enough
  // that nobody has to sit around clicking "next hand" between rounds.
  useEffect(() => {
    if (!hand || hand.status !== 'complete') {
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
  }, [hand?.status, hand?.id, gameId]);

  const isMyTurn = hand?.status === 'in_progress' && hand.current_turn_user_id === myUserId;
  const turnProgress =
    secondsLeft !== null && gameTurnDuration ? secondsLeft / gameTurnDuration : 1;
  const toCall = hand && me ? hand.current_bet - me.committed_this_street : 0;
  const minRaiseTarget = hand ? hand.current_bet + hand.min_raise : 0;
  const maxRaiseTarget = me ? me.stack + me.committed_this_street : 0;

  useEffect(() => {
    if (isMyTurn) {
      setRaiseText(String(Math.min(maxRaiseTarget, minRaiseTarget)));
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
    setRaiseText(String(clampRaise(target)));
  }

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

  if (loading || !hand) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={[styles.safeArea, styles.centered]}>
          <ActivityIndicator color={theme.text} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const lastAction = actions[actions.length - 1];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <ThemedText type="smallBold">Main #{hand.hand_number}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {hand.current_street}
          </ThemedText>
        </ThemedView>

        <View style={styles.oval}>
          {opponents.map((item, index) => {
            const pos = seatPosition(index, opponents.length);
            const isActing = item.user_id === hand.current_turn_user_id && hand.status === 'in_progress';
            const isWinner = hand.status === 'complete' && winnerIdSet.has(item.user_id);
            return (
              <Animated.View
                key={item.id}
                style={[
                  styles.seat,
                  { left: pos.left, top: pos.top },
                  isActing && { transform: [{ scale: pulse.interpolate({ inputRange: [0.4, 1], outputRange: [1.06, 1] }) }] },
                ]}>
                <View style={styles.avatarWrap}>
                  {isActing && (
                    <TimerRing size={52} strokeWidth={3} progress={turnProgress} />
                  )}
                  <View
                    style={[
                      styles.avatar,
                      isActing && styles.avatarActing,
                      isWinner && styles.avatarWinner,
                      item.is_folded && styles.avatarFolded,
                    ]}>
                    <ThemedText style={styles.avatarInitial}>
                      {(item.profiles?.display_name ?? '?').slice(0, 1).toUpperCase()}
                    </ThemedText>
                    {item.seat_number === hand.dealer_seat && (
                      <View style={styles.dealerChip}>
                        <ThemedText style={styles.dealerChipText}>D</ThemedText>
                      </View>
                    )}
                  </View>
                </View>
                <ThemedText
                  type="small"
                  style={[styles.seatName, isActing && styles.seatNameActing]}
                  numberOfLines={1}>
                  {item.profiles?.display_name ?? 'Joueur'}
                  {isWinner ? ' 🏆' : ''}
                </ThemedText>
                <ThemedText style={styles.seatStack}>
                  {item.stack}
                  {item.is_folded ? ' · couché' : item.is_all_in ? ' · all-in' : ''}
                </ThemedText>
                {item.committed_this_street > 0 && (
                  <View style={styles.betPill}>
                    <ThemedText style={styles.betPillText}>{item.committed_this_street}</ThemedText>
                  </View>
                )}
                {hand.status === 'complete' && holeCards[item.user_id] && (
                  <View style={styles.seatCards}>
                    {holeCards[item.user_id].map((c, i) => (
                      <PlayingCard key={i} card={c} size="small" />
                    ))}
                  </View>
                )}
              </Animated.View>
            );
          })}

          <View style={styles.centerArea}>
            <View style={styles.boardCards}>
              {hand.board_cards.map((c, i) => (
                <PlayingCard key={i} card={c} size="medium" />
              ))}
            </View>
            <Animated.View style={[styles.potPill, { transform: [{ scale: potPulse }] }]}>
              <ThemedText style={styles.potPillText}>Pot {hand.pot_total}</ThemedText>
            </Animated.View>
          </View>

          {chipFlightVisible && (
            <Animated.View
              style={[
                styles.flyingChip,
                {
                  left: chipFlightTarget.x - 12,
                  top: chipFlightTarget.y - 12,
                  transform: chipFlight.getTranslateTransform(),
                },
              ]}>
              <ThemedText style={styles.flyingChipText}>●</ThemedText>
            </Animated.View>
          )}
        </View>

        {lastAction && hand.status === 'in_progress' && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.logLine}>
            {handPlayers.find((p) => p.user_id === lastAction.user_id)?.profiles?.display_name ?? 'Joueur'}{' '}
            {ACTION_LABEL[lastAction.action_type] ?? lastAction.action_type}
            {lastAction.amount > 0 ? ` (${lastAction.amount})` : ''}
          </ThemedText>
        )}

        <ThemedView style={styles.myArea}>
          {me && (
            <View style={styles.avatarWrap}>
              {isMyTurn && <TimerRing size={48} strokeWidth={3} progress={turnProgress} />}
              <View
                style={[
                  styles.myAvatar,
                  isMyTurn && styles.avatarActing,
                  hand.status === 'complete' && winnerIdSet.has(me.user_id) && styles.avatarWinner,
                ]}>
                <ThemedText style={styles.avatarInitial}>
                  {(me.profiles?.display_name ?? '?').slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
            </View>
          )}
          <View style={styles.myCardsRow}>
            {myCards ? myCards.map((c, i) => <PlayingCard key={i} card={c} size="large" />) : null}
          </View>
          <View style={styles.myInfo}>
            <ThemedText type="smallBold">{me?.stack ?? 0} jetons</ThemedText>
            {bestHand && (
              <ThemedText type="small" themeColor="textSecondary">
                {bestHand.descr}
              </ThemedText>
            )}
          </View>
        </ThemedView>

        {me?.stack === 0 && (
          <Pressable
            onPress={handleRebuy}
            disabled={rebuying}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              { borderColor: theme.text },
              (pressed || rebuying) && styles.pressed,
            ]}>
            {rebuying ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText style={styles.buttonText}>Rebuy</ThemedText>
            )}
          </Pressable>
        )}

        {hand.status === 'complete' ? (
          <ThemedView style={styles.actions}>
            {hand.winners?.map((pot) => (
              <ThemedText key={pot.potIndex}>
                Pot {pot.potIndex + 1} ({pot.amount}) :{' '}
                {pot.winnerIds
                  .map((id) => handPlayers.find((p) => p.user_id === id)?.profiles?.display_name ?? id)
                  .join(', ')}
              </ThemedText>
            ))}
            <Pressable
              onPress={handleStartNext}
              disabled={startingNext}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.text },
                (pressed || startingNext) && styles.pressed,
              ]}>
              {startingNext ? (
                <ActivityIndicator color={theme.background} />
              ) : (
                <ThemedText style={[styles.buttonText, { color: theme.background }]}>
                  {nextHandCountdown ? `Main suivante dans ${nextHandCountdown}s...` : 'Main suivante'}
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>
        ) : (
          <ThemedView style={styles.actions}>
            {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}

            <ThemedView style={styles.quickBets}>
              <QuickButton label="1/2 pot" onPress={() => setQuickRaise(0.5)} theme={theme} />
              <QuickButton label="Pot" onPress={() => setQuickRaise(1)} theme={theme} />
              <QuickButton
                label="Min"
                onPress={() => setRaiseText(String(clampRaise(minRaiseTarget)))}
                theme={theme}
              />
              <QuickButton
                label="All-in"
                onPress={() => setRaiseText(String(clampRaise(maxRaiseTarget)))}
                theme={theme}
              />
            </ThemedView>

            <TextInput
              value={raiseText}
              onChangeText={setRaiseText}
              keyboardType="number-pad"
              editable={isMyTurn && !submitting}
              placeholder={`Relancer à... (min ${minRaiseTarget})`}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />

            <ThemedView style={styles.actionButtons}>
              <Pressable
                onPress={() => submitAction('fold')}
                disabled={!isMyTurn || submitting}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  { borderColor: theme.text },
                  (pressed || !isMyTurn || submitting) && styles.pressed,
                ]}>
                <ThemedText style={styles.buttonText}>Se coucher</ThemedText>
              </Pressable>

              <Pressable
                onPress={() => submitAction(toCall > 0 ? 'call' : 'check')}
                disabled={!isMyTurn || submitting}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.text },
                  (pressed || !isMyTurn || submitting) && styles.pressed,
                ]}>
                <ThemedText style={[styles.buttonText, { color: theme.background }]}>
                  {toCall > 0 ? `Suivre (${toCall})` : 'Check'}
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={() => submitAction('raise', clampRaise(Number(raiseText) || minRaiseTarget))}
                disabled={!isMyTurn || submitting}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.text },
                  (pressed || !isMyTurn || submitting) && styles.pressed,
                ]}>
                <ThemedText style={[styles.buttonText, { color: theme.background }]}>
                  Relancer {raiseText ? `à ${clampRaise(Number(raiseText) || minRaiseTarget)}` : `(min ${minRaiseTarget})`}
                </ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function QuickButton({
  label,
  onPress,
  theme,
}: {
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickButton,
        { borderColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: Spacing.one,
  },
  oval: {
    width: OVAL_WIDTH,
    height: OVAL_HEIGHT,
    alignSelf: 'center',
    backgroundColor: FELT,
    borderRadius: OVAL_HEIGHT / 2,
    borderWidth: 6,
    borderColor: FELT_EDGE,
    marginTop: Spacing.three,
  },
  centerArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Starts below the fixed opponent row (avatar + name + stack + bet
    // pill) so the board/pot never share vertical space with seats.
    top: SEAT_ROW_TOP + SEAT_SIZE + 46,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  boardCards: {
    flexDirection: 'row',
    gap: Spacing.one,
    minHeight: 58,
  },
  potPill: {
    backgroundColor: '#00000055',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  potPillText: {
    color: GOLD,
    fontWeight: '700',
    fontSize: 14,
  },
  flyingChip: {
    position: 'absolute',
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
    position: 'absolute',
    width: SEAT_SIZE,
    alignItems: 'center',
    gap: 2,
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3a3f47',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#00000000',
  },
  avatarActing: {
    borderColor: GOLD,
    backgroundColor: '#5a4a1f',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
  avatarWinner: {
    borderColor: GOLD,
    backgroundColor: '#6b5417',
  },
  avatarFolded: {
    opacity: 0.4,
  },
  avatarInitial: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  dealerChip: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00000055',
  },
  dealerChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#000',
  },
  seatName: {
    color: '#fff',
    maxWidth: SEAT_SIZE,
  },
  seatNameActing: {
    color: GOLD,
    fontWeight: '700',
  },
  seatStack: {
    color: '#e8e8e8',
    fontSize: 11,
  },
  betPill: {
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  betPillText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
  },
  seatCards: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
  },
  logLine: {
    textAlign: 'center',
  },
  myArea: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  myAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3a3f47',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#00000000',
  },
  myCardsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  myInfo: {
    alignItems: 'center',
  },
  actions: {
    gap: Spacing.two,
  },
  quickBets: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  quickButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#e5484d',
  },
  pressed: {
    opacity: 0.7,
  },
});
