import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

export type CardSize = 'small' | 'medium' | 'large';

const SIZES: Record<CardSize, { width: number; height: number; font: number }> = {
  small: { width: 30, height: 42, font: 14 },
  medium: { width: 42, height: 58, font: 18 },
  large: { width: 56, height: 78, font: 24 },
};

export function PlayingCard({
  card,
  size = 'medium',
  faceDown = false,
  animateIn = true,
}: {
  card?: string;
  size?: CardSize;
  faceDown?: boolean;
  animateIn?: boolean;
}) {
  const dims = SIZES[size];
  const progress = useRef(new Animated.Value(animateIn ? 0 : 1)).current;

  useEffect(() => {
    if (!animateIn) return;
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 60,
    }).start();
  }, [card, faceDown, animateIn, progress]);

  const style = [
    styles.card,
    { width: dims.width, height: dims.height },
    faceDown ? styles.faceDown : styles.faceUp,
    animateIn
      ? {
          opacity: progress,
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
          ],
        }
      : null,
  ];

  if (faceDown || !card) {
    return (
      <Animated.View style={style}>
        <View style={styles.faceDownPattern} />
      </Animated.View>
    );
  }

  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const isRed = RED_SUITS.has(suit);

  return (
    <Animated.View style={style}>
      <Animated.Text style={[styles.rank, { fontSize: dims.font, color: isRed ? '#c4304a' : '#1a1a1a' }]}>
        {rank}
      </Animated.Text>
      <Animated.Text style={[styles.suit, { fontSize: dims.font, color: isRed ? '#c4304a' : '#1a1a1a' }]}>
        {SUIT_SYMBOL[suit] ?? suit}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  faceUp: {
    backgroundColor: '#f7f3ea',
    borderWidth: 1,
    borderColor: '#00000022',
  },
  faceDown: {
    backgroundColor: '#1c3f66',
    borderWidth: 1,
    borderColor: '#0b2038',
  },
  faceDownPattern: {
    width: '70%',
    height: '70%',
    borderRadius: Spacing.one,
    borderWidth: 2,
    borderColor: '#3a6ea5',
  },
  rank: {
    fontWeight: '800',
    lineHeight: undefined,
  },
  suit: {
    fontWeight: '600',
    marginTop: -2,
  },
});
