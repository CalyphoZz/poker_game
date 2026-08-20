/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// The app is a dark "casino" surface everywhere, not just at the table --
// light and dark point at the same palette on purpose so the look never
// flips to a bland white page depending on the phone's system setting.
const CASINO_DARK = {
  text: '#ffffff',
  background: '#0d1117',
  backgroundElement: '#1b212b',
  backgroundSelected: '#2a323f',
  textSecondary: '#9aa4b0',
} as const;

export const Colors = {
  light: CASINO_DARK,
  dark: CASINO_DARK,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Brand accents shared with the table screen's felt/gold/chip styling --
// kept outside the light/dark ThemeColor map since they never change with
// theme, only with semantic meaning (primary action, positive, danger).
export const Brand = {
  gold: '#f5c942',
  goldPressed: '#d9ad2b',
  green: '#3ddc84',
  red: '#e5484d',
  felt: '#125536',
  feltLight: '#1d6b48',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
