-- Lobby presence needs live updates as players join/leave/ready-up. Neither
-- table carries secret data (hole cards deliberately never go through
-- postgres_changes -- see architecture plan section 2), so broadcasting them
-- is safe as long as RLS keeps applying, which it does for authenticated
-- Realtime subscriptions.
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_players;
