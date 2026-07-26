import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// A circular countdown drawn around whoever's turn it is -- `progress` is
// the fraction of the turn remaining (1 = just started, 0 = about to time
// out), so the ring visibly depletes instead of showing a plain number.
export function TimerRing({
  size,
  strokeWidth = 3,
  progress,
  color = '#f5c942',
}: {
  size: number;
  strokeWidth?: number;
  progress: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <View style={[styles.container, { width: size, height: size }]} pointerEvents="none">
      <Svg width={size} height={size} style={styles.svg}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#ffffff33"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    position: 'absolute',
  },
});
