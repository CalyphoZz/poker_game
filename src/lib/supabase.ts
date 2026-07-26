import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient, type Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY -- see .env.example',
  );
}

// expo-secure-store persists the session (and therefore the stable auth.uid())
// across app relaunches, which is what makes a guest's identity durable for
// the lifetime of the install without requiring an account. It has no web/
// Node implementation, so on web we leave `storage` unset and let
// supabase-js fall back to its own default (browser localStorage, or an
// in-memory no-op during static export/SSR where no window exists).
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Every player -- guest or upgraded to a real account -- needs a Supabase
// Auth session before doing anything else, since auth.uid() is what RLS and
// game_players.user_id key off of. Called once at app startup.
export async function ensureSession(): Promise<Session> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    return session;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) {
    throw error ?? new Error('signInAnonymously() returned no session');
  }
  return data.session;
}
