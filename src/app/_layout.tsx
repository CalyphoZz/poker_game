import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { Brand } from '@/constants/theme';
import { ensureSession } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

// The app is a dark casino surface everywhere (see theme.ts) -- the native
// header bar needs to follow suit rather than react-navigation's default
// light theme, or every screen with a header shows a jarring white bar
// above a dark body.
const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0d1117',
    card: '#1b212b',
    text: '#ffffff',
    border: '#2a323f',
    primary: Brand.gold,
  },
};

export default function RootLayout() {
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    ensureSession()
      .catch((error) => console.error('Failed to establish a Supabase session', error))
      .finally(() => {
        setSessionReady(true);
        SplashScreen.hideAsync();
      });
  }, []);

  if (!sessionReady) {
    return null;
  }

  return (
    <ThemeProvider value={AppTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: '#1b212b' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { color: '#ffffff' },
          headerShadowVisible: false,
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="join" options={{ headerShown: true, title: 'Rejoindre une partie' }} />
        <Stack.Screen name="lobby/[gameId]" options={{ headerShown: true, title: 'Lobby' }} />
        <Stack.Screen name="table/[gameId]" options={{ headerShown: true, title: 'Table' }} />
      </Stack>
    </ThemeProvider>
  );
}
