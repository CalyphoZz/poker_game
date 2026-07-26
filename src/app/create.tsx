import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

function useNumericField(initial: number) {
  const [text, setText] = useState(String(initial));
  const value = Number.parseInt(text, 10);
  return { text, setText, value, valid: Number.isInteger(value) && value > 0 };
}

export default function CreateGameScreen() {
  const theme = useTheme();
  const smallBlind = useNumericField(10);
  const bigBlind = useNumericField(20);
  const startingStack = useNumericField(1000);
  const maxPlayers = useNumericField(6);
  const turnDurationSeconds = useNumericField(25);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid =
    smallBlind.valid &&
    bigBlind.valid &&
    startingStack.valid &&
    maxPlayers.valid &&
    turnDurationSeconds.valid &&
    bigBlind.value > smallBlind.value &&
    maxPlayers.value >= 2 &&
    maxPlayers.value <= 10;

  async function handleCreate() {
    setError(null);
    setLoading(true);
    const { data, error: invokeError } = await supabase.functions.invoke('create-game', {
      body: {
        smallBlind: smallBlind.value,
        bigBlind: bigBlind.value,
        startingStack: startingStack.value,
        maxPlayers: maxPlayers.value,
        turnDurationSeconds: turnDurationSeconds.value,
      },
    });
    setLoading(false);

    if (invokeError) {
      setError(invokeError.message ?? "La création de la partie a échoué.");
      return;
    }

    router.replace(`/lobby/${data.game.id}`);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Field label="Petite blinde" field={smallBlind} theme={theme} />
        <Field label="Grosse blinde" field={bigBlind} theme={theme} />
        <Field label="Stack de départ" field={startingStack} theme={theme} />
        <Field label="Joueurs max (2-10)" field={maxPlayers} theme={theme} />
        <Field label="Temps par tour (secondes)" field={turnDurationSeconds} theme={theme} />

        {error && (
          <ThemedText style={styles.error} themeColor="text">
            {error}
          </ThemedText>
        )}

        <Pressable
          disabled={!formValid || loading}
          onPress={handleCreate}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.text },
            (pressed || !formValid || loading) && styles.pressed,
          ]}>
          {loading ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: theme.background }]}>
              Créer la partie
            </ThemedText>
          )}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field({
  label,
  field,
  theme,
}: {
  label: string;
  field: ReturnType<typeof useNumericField>;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <ThemedView style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={field.text}
        onChangeText={field.setText}
        keyboardType="number-pad"
        style={[
          styles.input,
          { color: theme.text, borderColor: field.valid ? theme.backgroundSelected : 'red' },
        ]}
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
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
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
