import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface RenameModalProps {
  visible: boolean;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}

export function RenameModal({ visible, initialValue, onClose, onSave }: RenameModalProps) {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    await onSave(trimmed);
    setSaving(false);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="smallBold" style={styles.title}>
            Modifier mon pseudo
          </ThemedText>
          <TextInput
            value={value}
            onChangeText={setValue}
            maxLength={24}
            autoFocus
            placeholderTextColor={theme.textSecondary}
            style={styles.input}
          />
          <View style={styles.buttonRow}>
            <Pressable
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [styles.button, styles.secondaryButton, pressed && styles.pressed]}>
              <ThemedText style={[styles.buttonText, styles.secondaryButtonText]}>Annuler</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving || !value.trim()}
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                (pressed || saving || !value.trim()) && styles.pressed,
              ]}>
              <ThemedText style={[styles.buttonText, styles.primaryButtonText]}>Enregistrer</ThemedText>
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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000099',
    padding: Spacing.four,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1b212b',
    borderWidth: 1,
    borderColor: '#2a323f',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#2a323f',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: '#ffffff',
    backgroundColor: '#10141a',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: Brand.gold,
  },
  primaryButtonText: {
    color: '#241a02',
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: '#3a4453',
  },
  secondaryButtonText: {
    color: '#9aa4b0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
