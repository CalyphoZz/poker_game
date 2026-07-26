import * as Crypto from 'expo-crypto';

// crypto.randomUUID() (what expo-crypto's web shim delegates to) is only
// available in "secure contexts" -- https, or the special localhost
// exception. Opening the app via a plain-HTTP LAN address (e.g.
// http://192.168.1.50:8081, needed to test from a second device) is NOT a
// secure context, so it throws there even though everything else works
// fine. The value only needs to be unique per action, not unpredictable, so
// a Math.random-based fallback is perfectly safe here.
function randomUuidFallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateClientActionId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return randomUuidFallback();
  }
}
