import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameSettingsModal } from '@/components/game-settings-modal';
import { RenameModal } from '@/components/rename-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { updateMyDisplayName } from '@/lib/profile';
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
  turn_duration_seconds: number;
  blind_increase_interval_minutes: number;
}

interface GamePlayerRow {
  id: string;
  user_id: string;
  seat_number: number | null;
  stack: number;
  status: string;
  is_ready: boolean;
  is_bot: boolean;
  bot_difficulty: string | null;
  profiles: { display_name: string } | null;
}

const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const BOT_DIFFICULTY_LABEL: Record<(typeof BOT_DIFFICULTIES)[number], string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
};

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

  const [addingBot, setAddingBot] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const refreshPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('game_players')
      .select(
        'id, user_id, seat_number, stack, status, is_ready, is_bot, bot_difficulty, profiles(display_name)',
      )
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

  async function handleAddBot(difficulty: (typeof BOT_DIFFICULTIES)[number]) {
    setBotError(null);
    setAddingBot(true);
    const { error } = await supabase.functions.invoke('add-bot', { body: { gameId, difficulty } });
    setAddingBot(false);
    if (error) {
      setBotError(error.message ?? "Impossible d'ajouter le bot.");
    }
  }

  async function handleRemoveBot(botUserId: string) {
    await supabase.functions.invoke('remove-bot', { body: { gameId, botUserId } });
  }

  async function handleRename(newName: string) {
    await updateMyDisplayName(newName);
    await refreshPlayers();
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
          {myUserId === game.host_user_id && (
            <Pressable
              onPress={() => setSettingsOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.gearButton, pressed && styles.pressed]}>
              <ThemedText style={styles.gearIcon}>⚙️</ThemedText>
            </Pressable>
          )}
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
                {item.is_bot ? ` (bot ${BOT_DIFFICULTY_LABEL[item.bot_difficulty as 'easy'] ?? ''})` : ''}
              </ThemedText>
              {item.is_bot ? (
                <Pressable onPress={() => handleRemoveBot(item.user_id)} hitSlop={8}>
                  <ThemedText themeColor="textSecondary">Retirer</ThemedText>
                </Pressable>
              ) : (
                <ThemedView style={styles.playerRowTrailing}>
                  {item.user_id === myUserId && (
                    <Pressable onPress={() => setRenameOpen(true)} hitSlop={8}>
                      <ThemedText style={styles.pencil}>✏️</ThemedText>
                    </Pressable>
                  )}
                  <ThemedText themeColor={item.is_ready ? 'text' : 'textSecondary'}>
                    {item.is_ready ? 'Prêt' : 'Pas prêt'}
                  </ThemedText>
                </ThemedView>
              )}
            </ThemedView>
          )}
        />

        <ThemedView style={styles.actions}>
          {botError && <ThemedText style={styles.error}>{botError}</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">
            Ajouter un bot pour tester seul
          </ThemedText>
          <ThemedView style={styles.botRow}>
            {BOT_DIFFICULTIES.map((difficulty) => (
              <Pressable
                key={difficulty}
                onPress={() => handleAddBot(difficulty)}
                disabled={addingBot || players.length >= game.max_players}
                style={({ pressed }) => [
                  styles.botButton,
                  { borderColor: theme.backgroundSelected },
                  (pressed || addingBot || players.length >= game.max_players) && styles.pressed,
                ]}>
                <ThemedText type="small">+ {BOT_DIFFICULTY_LABEL[difficulty]}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>

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

      <GameSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        gameId={gameId}
        initial={{
          smallBlind: game.small_blind,
          bigBlind: game.big_blind,
          startingStack: game.starting_stack,
          turnDurationSeconds: game.turn_duration_seconds,
          blindIncreaseIntervalMinutes: game.blind_increase_interval_minutes,
        }}
      />

      <RenameModal
        visible={renameOpen}
        initialValue={me?.profiles?.display_name ?? ''}
        onClose={() => setRenameOpen(false)}
        onSave={handleRename}
      />
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
    position: 'relative',
  },
  gearButton: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    padding: Spacing.one,
  },
  gearIcon: {
    fontSize: 20,
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
  playerRowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  pencil: {
    fontSize: 16,
  },
  actions: {
    gap: Spacing.two,
  },
  botRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  botButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
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
