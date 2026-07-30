import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
        <ThemedText type="small" themeColor="textSecondary">
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
            { color: theme.text, borderColor: pseudo.trim() ? theme.backgroundSelected : 'red' },
          ]}
        />

        <ThemedText type="small" themeColor="textSecondary">
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
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          disabled={!canSubmit || loading}
          onPress={handleJoin}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.text },
            (pressed || !canSubmit || loading) && styles.pressed,
          ]}>
          {loading ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: theme.background }]}>
              Rejoindre
            </ThemedText>
          )}
        </Pressable>
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 24,
    letterSpacing: 4,
    textAlign: 'center',
  },
  pseudoInput: {
    fontSize: 16,
    letterSpacing: 0,
  },
  error: {
    color: '#e5484d',
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
