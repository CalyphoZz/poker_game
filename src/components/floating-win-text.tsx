import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

// A quick "+amount" that fades in, floats up slightly, then fades out next
// to a winning seat -- this is the precise "who won" signal now that a
// modal no longer interrupts every hand (see the table screen). Always
// mounted per seat; it only animates when `amount` is actually positive and
// `triggerKey` (the hand id) changes, so it stays silent for non-winners.
export function FloatingWinText({ amount, triggerKey }: { amount: number; triggerKey: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const playedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!amount || playedForRef.current === triggerKey) return;
    playedForRef.current = triggerKey;
    opacity.setValue(0);
    translateY.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
    Animated.timing(translateY, { toValue: -22, duration: 1400, useNativeDriver: true }).start();
  }, [amount, triggerKey, opacity, translateY]);

  if (!amount) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity, transform: [{ translateY }] }]}>
      <Animated.Text style={styles.text}>+{amount}</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: -16,
    alignSelf: 'center',
  },
  text: {
    color: '#f5c942',
    fontWeight: '800',
    fontSize: 15,
  },
});
