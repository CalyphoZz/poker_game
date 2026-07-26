import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

interface ActiveGame {
  gameId: string;
  inviteCode: string;
}

export default function HomeScreen() {
  const theme = useTheme();
  const [activeGames, setActiveGames] = useState<ActiveGame[]>([]);

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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Poker Friend
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          Poker Texas Hold&apos;em en argent fictif, entre amis.
        </ThemedText>

        {activeGames.length > 0 && (
          <ThemedView style={styles.resumeSection}>
            <ThemedText type="small" themeColor="textSecondary">
              Partie{activeGames.length > 1 ? 's' : ''} en cours
            </ThemedText>
            {activeGames.map((item) => (
              <Pressable
                key={item.gameId}
                onPress={() => router.push(`/lobby/${item.gameId}`)}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  { borderColor: theme.text },
                  pressed && styles.pressed,
                ]}>
                <ThemedText style={styles.buttonText}>Reprendre {item.inviteCode}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        <ThemedView style={styles.actions}>
          <Pressable
            onPress={() => router.push('/create')}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.text },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={[styles.buttonText, { color: theme.background }]}>
              Créer une partie
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => router.push('/join')}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              { borderColor: theme.text },
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
  title: {
    textAlign: 'center',
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
