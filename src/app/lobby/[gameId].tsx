import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

interface GameRow {
  id: string;
  invite_code: string;
  host_user_id: string;
  status: string;
  max_players: number;
  small_blind: number;
  big_blind: number;
  starting_stack: number;
}

interface GamePlayerRow {
  id: string;
  user_id: string;
  seat_number: number | null;
  stack: number;
  status: string;
  is_ready: boolean;
  profiles: { display_name: string } | null;
}

export default function LobbyScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const theme = useTheme();

  const [game, setGame] = useState<GameRow | null>(null);
  const [players, setPlayers] = useState<GamePlayerRow[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const refreshPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('game_players')
      .select('id, user_id, seat_number, stack, status, is_ready, profiles(display_name)')
      .eq('game_id', gameId)
      .neq('status', 'left')
      .order('seat_number', { ascending: true });
    setPlayers((data as unknown as GamePlayerRow[]) ?? []);
  }, [gameId]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (isMounted) setMyUserId(user?.id ?? null);

      const { data: gameData } = await supabase.from('games').select('*').eq('id', gameId).single();
      if (isMounted) setGame(gameData);

      await refreshPlayers();

      const { data: activeHand } = await supabase
        .from('hands')
        .select('id')
        .eq('game_id', gameId)
        .eq('status', 'in_progress')
        .maybeSingle();
      if (isMounted && activeHand) {
        router.replace(`/table/${gameId}`);
        return;
      }

      if (isMounted) setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`lobby-${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => refreshPlayers(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => setGame(payload.new as GameRow),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hands', filter: `game_id=eq.${gameId}` },
        () => router.replace(`/table/${gameId}`),
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [gameId, refreshPlayers]);

  const me = players.find((p) => p.user_id === myUserId);

  async function toggleReady() {
    if (!me) return;
    await supabase.from('game_players').update({ is_ready: !me.is_ready }).eq('id', me.id);
  }

  async function handleLeave() {
    setLeaving(true);
    await supabase.functions.invoke('leave-game', { body: { gameId } });
    setLeaving(false);
    router.replace('/');
  }

  async function handleStart() {
    setStartError(null);
    setStarting(true);
    const { error } = await supabase.functions.invoke('start-hand', { body: { gameId } });
    setStarting(false);
    if (error) {
      setStartError(error.message ?? 'Impossible de démarrer la partie.');
      return;
    }
    router.replace(`/table/${gameId}`);
  }

  if (loading || !game) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={[styles.safeArea, styles.centered]}>
          <ActivityIndicator color={theme.text} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView type="backgroundElement" style={styles.codeBox}>
          <ThemedText type="small" themeColor="textSecondary">
            Code d&apos;invitation
          </ThemedText>
          <ThemedText type="title" style={styles.code}>
            {game.invite_code}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Blindes {game.small_blind}/{game.big_blind} · Stack {game.starting_stack} ·{' '}
            {players.length}/{game.max_players} joueurs
          </ThemedText>
        </ThemedView>

        <FlatList
          data={players}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={styles.playerRow}>
              <ThemedText style={styles.playerName}>
                Siège {item.seat_number} · {item.profiles?.display_name ?? 'Joueur'}
                {item.user_id === game.host_user_id ? ' (host)' : ''}
                {item.user_id === myUserId ? ' (moi)' : ''}
              </ThemedText>
              <ThemedText themeColor={item.is_ready ? 'text' : 'textSecondary'}>
                {item.is_ready ? 'Prêt' : 'Pas prêt'}
              </ThemedText>
            </ThemedView>
          )}
        />

        <ThemedView style={styles.actions}>
          {startError && <ThemedText style={styles.error}>{startError}</ThemedText>}

          <Pressable
            onPress={handleStart}
            disabled={players.length < 2 || starting}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.text },
              (pressed || players.length < 2 || starting) && styles.pressed,
            ]}>
            {starting ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <ThemedText style={[styles.buttonText, { color: theme.background }]}>
                Démarrer la partie
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            onPress={toggleReady}
            disabled={!me}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.text },
              (pressed || !me) && styles.pressed,
            ]}>
            <ThemedText style={[styles.buttonText, { color: theme.background }]}>
              {me?.is_ready ? 'Se marquer pas prêt' : 'Se marquer prêt'}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={handleLeave}
            disabled={leaving}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              { borderColor: theme.text },
              (pressed || leaving) && styles.pressed,
            ]}>
            {leaving ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText style={styles.buttonText}>Quitter</ThemedText>
            )}
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeBox: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  code: {
    letterSpacing: 6,
  },
  list: {
    flex: 1,
  },
  error: {
    color: '#e5484d',
  },
  playerRow: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerName: {
    flexShrink: 1,
  },
  actions: {
    gap: Spacing.two,
  },
  button: {
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
  pressed: {
    opacity: 0.7,
  },
});
