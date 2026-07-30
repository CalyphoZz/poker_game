import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

// A gradient-shaded felt instead of a flat backgroundColor -- lighter/warmer
// near the center (where the action is) fading to a darker green at the
// rail, the way real felt catches light unevenly. Normalized 0-100 viewBox
// with preserveAspectRatio="none" so it stretches to fill the table
// container at any size without needing a measured width/height.
export function TableFelt() {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="felt" cx="50%" cy="42%" r="70%">
          <Stop offset="0%" stopColor="#1d6b48" />
          <Stop offset="55%" stopColor="#125536" />
          <Stop offset="100%" stopColor="#0a3521" />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#felt)" />
    </Svg>
  );
}
