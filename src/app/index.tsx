import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

interface ActiveGame {
  gameId: string;
  inviteCode: string;
}

export default function HomeScreen() {
  const [activeGames, setActiveGames] = useState<ActiveGame[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // A force-quit + relaunch has no local memory of "which game was I in" --
  // the server already knows via game_players, so check that instead of
  // persisting anything locally. The lobby screen itself already redirects
  // on to the table if a hand is in progress, so resuming here always just
  // means "go to the lobby for this game".
  useEffect(() => {
    let isMounted = true;
    async function checkActiveGames() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('game_players')
        .select('game_id, games(id, invite_code, status)')
        .eq('user_id', user.id)
        .neq('status', 'left');

      const active = (data ?? [])
        .map((row) => row.games as unknown as { id: string; invite_code: string; status: string } | null)
        .filter((g): g is { id: string; invite_code: string; status: string } => !!g && g.status !== 'ended')
        .map((g) => ({ gameId: g.id, inviteCode: g.invite_code }));

      if (isMounted) setActiveGames(active);
    }
    checkActiveGames();
    return () => {
      isMounted = false;
    };
  }, []);

  // Straight into the lobby with sane defaults -- no config form up front.
  // The host adjusts blinds/stack/timers afterward from the lobby's
  // settings wheel, which feels far less "web form" on a phone.
  async function handleCreateGame() {
    setCreateError(null);
    setCreating(true);
    const { data, error } = await supabase.functions.invoke('create-game', { body: {} });
    setCreating(false);
    if (error) {
      setCreateError(error.message ?? 'Impossible de créer la partie.');
      return;
    }
    router.replace(`/lobby/${data.game.id}`);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.hero}>
          <ThemedText style={styles.suitRow}>♠ ♥ ♦ ♣</ThemedText>
          <ThemedText type="title" style={styles.title}>
            Poker <ThemedText type="title" style={styles.titleAccent}>Friend</ThemedText>
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Texas Hold&apos;em en argent fictif, entre amis.
          </ThemedText>
        </ThemedView>

        {activeGames.length > 0 && (
          <ThemedView style={styles.resumeSection}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              Partie{activeGames.length > 1 ? 's' : ''} en cours
            </ThemedText>
            {activeGames.map((item) => (
              <Pressable
                key={item.gameId}
                onPress={() => router.push(`/lobby/${item.gameId}`)}
                style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}>
                <ThemedText style={styles.resumeIcon}>▶</ThemedText>
                <ThemedText style={styles.resumeText}>Reprendre {item.inviteCode}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {createError && <ThemedText style={styles.error}>{createError}</ThemedText>}

        <ThemedView style={styles.actions}>
          <Pressable
            onPress={handleCreateGame}
            disabled={creating}
            style={({ pressed }) => [
              styles.button,
              styles.primaryButton,
              (pressed || creating) && styles.pressed,
            ]}>
            {creating ? (
              <ActivityIndicator color="#241a02" />
            ) : (
              <ThemedText style={[styles.buttonText, styles.primaryButtonText]}>
                Créer une partie
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.push('/join')}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.buttonText}>Rejoindre une partie</ThemedText>
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.five,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  suitRow: {
    fontSize: 22,
    letterSpacing: 10,
    color: Brand.gold,
    opacity: 0.85,
  },
  title: {
    textAlign: 'center',
    fontSize: 40,
    lineHeight: 46,
  },
  titleAccent: {
    fontSize: 40,
    lineHeight: 46,
    color: Brand.gold,
  },
  subtitle: {
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    maxWidth: 360,
    gap: Spacing.three,
    marginTop: Spacing.five,
  },
  resumeSection: {
    width: '100%',
    maxWidth: 360,
    gap: Spacing.two,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#1b212b',
    borderWidth: 1,
    borderColor: '#2a323f',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  resumeIcon: {
    color: Brand.green,
    fontSize: 14,
  },
  resumeText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: Brand.red,
    textAlign: 'center',
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: Brand.gold,
    shadowColor: Brand.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#241a02',
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: '#3a4453',
    backgroundColor: '#1b212b',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
