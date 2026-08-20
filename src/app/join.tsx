import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getMyDisplayName, updateMyDisplayName } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

export default function JoinGameScreen() {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyDisplayName().then(setPseudo);
  }, []);

  async function handleJoin() {
    setError(null);
    setLoading(true);
    await updateMyDisplayName(pseudo.trim());
    const { data, error: invokeError } = await supabase.functions.invoke('join-game', {
      body: { inviteCode: code.trim() },
    });
    setLoading(false);

    if (invokeError) {
      setError(invokeError.message ?? 'Impossible de rejoindre cette partie.');
      return;
    }

    router.replace(`/lobby/${data.game.id}`);
  }

  const canSubmit = code.trim().length > 0 && pseudo.trim().length > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Pseudo
          </ThemedText>
          <TextInput
            value={pseudo}
            onChangeText={setPseudo}
            maxLength={24}
            placeholder="Ton pseudo"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              styles.pseudoInput,
              { color: theme.text, borderColor: pseudo.trim() ? '#2a323f' : Brand.red },
            ]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            Code d&apos;invitation
          </ThemedText>
          <TextInput
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            placeholder="ABCDEF"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, styles.codeInput, { color: Brand.gold, borderColor: '#2a323f' }]}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable
            disabled={!canSubmit || loading}
            onPress={handleJoin}
            style={({ pressed }) => [
              styles.button,
              (pressed || !canSubmit || loading) && styles.pressed,
              (!canSubmit || loading) && styles.buttonDisabled,
            ]}>
            {loading ? (
              <ActivityIndicator color="#241a02" />
            ) : (
              <ThemedText style={styles.buttonText}>Rejoindre</ThemedText>
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
    justifyContent: 'center',
    padding: Spacing.four,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    backgroundColor: '#1b212b',
    borderWidth: 1,
    borderColor: '#2a323f',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 24,
    letterSpacing: 4,
    textAlign: 'center',
    backgroundColor: '#10141a',
  },
  codeInput: {
    fontWeight: '700',
  },
  pseudoInput: {
    fontSize: 16,
    letterSpacing: 0,
    textAlign: 'left',
  },
  error: {
    color: Brand.red,
  },
  button: {
    backgroundColor: Brand.gold,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.three,
    shadowColor: Brand.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: '#3a4453',
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#241a02',
  },
  pressed: {
    opacity: 0.7,
  },
});
