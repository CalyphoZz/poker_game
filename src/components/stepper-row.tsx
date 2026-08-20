import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';

// A labeled row with big +/- touch targets that cycles through a fixed list
// of presets, instead of a raw numeric TextInput -- game settings (blinds,
// stack, timers) only ever take a handful of sane values in practice, and
// tapping through them is a much more native mobile feel than typing digits
// on a soft keyboard.
interface StepperRowProps<T> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
  disabled?: boolean;
}

export function StepperRow<T>({
  label,
  options,
  value,
  onChange,
  format,
  disabled,
}: StepperRowProps<T>) {
  const index = options.indexOf(value);
  const canDecrement = !disabled && index > 0;
  const canIncrement = !disabled && index >= 0 && index < options.length - 1;

  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.controls}>
        <Pressable
          onPress={() => canDecrement && onChange(options[index - 1])}
          disabled={!canDecrement}
          hitSlop={8}
          style={({ pressed }) => [styles.stepButton, (pressed || !canDecrement) && styles.stepButtonDisabled]}>
          <ThemedText type="smallBold" style={canDecrement ? styles.stepGlyphActive : styles.stepGlyph}>
            −
          </ThemedText>
        </Pressable>

        <ThemedText type="smallBold" style={styles.value}>
          {format(value)}
        </ThemedText>

        <Pressable
          onPress={() => canIncrement && onChange(options[index + 1])}
          disabled={!canIncrement}
          hitSlop={8}
          style={({ pressed }) => [styles.stepButton, (pressed || !canIncrement) && styles.stepButtonDisabled]}>
          <ThemedText type="smallBold" style={canIncrement ? styles.stepGlyphActive : styles.stepGlyph}>
            +
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#3a4453',
    backgroundColor: '#10141a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: {
    opacity: 0.35,
  },
  stepGlyph: {
    color: '#9aa4b0',
  },
  stepGlyphActive: {
    color: Brand.gold,
  },
  value: {
    minWidth: 88,
    textAlign: 'center',
  },
});
