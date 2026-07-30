import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { StepperRow } from '@/components/stepper-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

// Poker settings only ever take a handful of sane values in practice, so
// every field here is a preset list stepped through with +/- rather than a
// numeric TextInput -- see stepper-row.tsx.
const BLIND_PRESETS = [
  { small: 5, big: 10 },
  { small: 10, big: 20 },
  { small: 25, big: 50 },
  { small: 50, big: 100 },
  { small: 100, big: 200 },
  { small: 250, big: 500 },
  { small: 500, big: 1000 },
] as const;

const STACK_PRESETS = [500, 1000, 1500, 2000, 3000, 5000, 10000] as const;
const TURN_DURATION_PRESETS = [15, 20, 25, 30, 45, 60] as const;
const BLIND_INTERVAL_PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;

function closestPreset<T>(options: readonly T[], pick: (o: T) => number, target: number): T {
  return options.reduce((best, o) => (Math.abs(pick(o) - target) < Math.abs(pick(best) - target) ? o : best));
}

interface GameSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  gameId: string;
  initial: {
    smallBlind: number;
    bigBlind: number;
    startingStack: number;
    turnDurationSeconds: number;
    blindIncreaseIntervalMinutes: number;
  };
}

export function GameSettingsModal({ visible, onClose, gameId, initial }: GameSettingsModalProps) {
  const theme = useTheme();
  const [blindPair, setBlindPair] = useState<(typeof BLIND_PRESETS)[number]>(BLIND_PRESETS[1]);
  const [stack, setStack] = useState<(typeof STACK_PRESETS)[number]>(STACK_PRESETS[1]);
  const [turnDuration, setTurnDuration] = useState<(typeof TURN_DURATION_PRESETS)[number]>(
    TURN_DURATION_PRESETS[2],
  );
  const [blindInterval, setBlindInterval] = useState<(typeof BLIND_INTERVAL_PRESETS)[number]>(
    BLIND_INTERVAL_PRESETS[1],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBlindPair(closestPreset(BLIND_PRESETS, (p) => p.big, initial.bigBlind));
    setStack(closestPreset(STACK_PRESETS, (v) => v, initial.startingStack));
    setTurnDuration(closestPreset(TURN_DURATION_PRESETS, (v) => v, initial.turnDurationSeconds));
    setBlindInterval(
      closestPreset(BLIND_INTERVAL_PRESETS, (v) => v, initial.blindIncreaseIntervalMinutes),
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: invokeError } = await supabase.functions.invoke('update-game-settings', {
      body: {
        gameId,
        smallBlind: blindPair.small,
        bigBlind: blindPair.big,
        startingStack: stack,
        turnDurationSeconds: turnDuration,
        blindIncreaseIntervalMinutes: blindInterval,
      },
    });
    setSaving(false);
    if (invokeError) {
      setError(invokeError.message ?? "Impossible d'enregistrer les paramètres.");
      return;
    }
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView type="backgroundElement" style={styles.sheet}>
          <ThemedText type="smallBold" style={styles.title}>
            Paramètres de la partie
          </ThemedText>

          <StepperRow
            label="Blindes"
            options={BLIND_PRESETS}
            value={blindPair}
            onChange={setBlindPair}
            format={(p) => `${p.small} / ${p.big}`}
          />
          <StepperRow
            label="Stack de départ"
            options={STACK_PRESETS}
            value={stack}
            onChange={setStack}
            format={(v) => `${v}`}
          />
          <StepperRow
            label="Temps par tour"
            options={TURN_DURATION_PRESETS}
            value={turnDuration}
            onChange={setTurnDuration}
            format={(v) => `${v}s`}
          />
          <StepperRow
            label="Augmentation des blindes"
            options={BLIND_INTERVAL_PRESETS}
            value={blindInterval}
            onChange={setBlindInterval}
            format={(v) => `${v} min`}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <View style={styles.buttonRow}>
            <Pressable
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [
                styles.button,
                styles.secondaryButton,
                { borderColor: theme.text },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={styles.buttonText}>Annuler</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.text },
                (pressed || saving) && styles.pressed,
              ]}>
              <ThemedText style={[styles.buttonText, { color: theme.background }]}>
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000088',
  },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.half,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  error: {
    color: '#e5484d',
    marginTop: Spacing.two,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
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
  pressed: {
    opacity: 0.7,
  },
});
