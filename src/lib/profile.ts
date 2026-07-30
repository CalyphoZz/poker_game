import { supabase } from '@/lib/supabase';

// profiles has a client-writable RLS policy scoped to the caller's own row
// (see supabase/migrations/..._init_schema.sql), so this is a plain
// authenticated update -- no Edge Function needed for a display name.
export async function getMyDisplayName(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return '';

  const { data } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  return data?.display_name ?? '';
}

export async function updateMyDisplayName(displayName: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('profiles').update({ display_name: displayName }).eq('id', user.id);
}
