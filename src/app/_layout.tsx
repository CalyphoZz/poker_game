import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { ensureSession } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
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
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="join" options={{ headerShown: true, title: 'Rejoindre une partie' }} />
        <Stack.Screen name="lobby/[gameId]" options={{ headerShown: true, title: 'Lobby' }} />
        <Stack.Screen name="table/[gameId]" options={{ headerShown: true, title: 'Table' }} />
      </Stack>
    </ThemeProvider>
  );
}
