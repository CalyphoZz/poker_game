import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
        <ThemedView type="backgroundElement" style={styles.sheet}>
          <ThemedText type="smallBold" style={styles.title}>
            Modifier mon pseudo
          </ThemedText>
          <TextInput
            value={value}
            onChangeText={setValue}
            maxLength={24}
            autoFocus
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
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
              disabled={saving || !value.trim()}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.text },
                (pressed || saving || !value.trim()) && styles.pressed,
              ]}>
              <ThemedText style={[styles.buttonText, { color: theme.background }]}>
                Enregistrer
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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000088',
    padding: Spacing.four,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
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
