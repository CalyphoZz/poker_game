-- Leaving is always freeing (never seat-allocating), so unlike join it needs
-- no cross-row contention handling -- a plain update is enough. Still kept as
-- a service-role-only RPC (mirroring join_game_by_code) rather than a
-- client-writable `status` column, because a client that could write
-- `status` directly could also flip it back to 'seated' and bypass
-- join_game_by_code's capacity/seat-allocation checks entirely.
create or replace function public.leave_game(
  p_game_id uuid,
  p_user_id uuid
)
returns public.game_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.game_players;
begin
  update public.game_players
  set status = 'left', seat_number = null, is_ready = false, left_at = now()
  where game_id = p_game_id and user_id = p_user_id and status <> 'left'
  returning * into v_result;

  if not found then
    raise exception 'You are not an active member of this game' using errcode = 'P0004';
  end if;

  return v_result;
end;
$$;

revoke all on function public.leave_game from public, anon, authenticated;
grant execute on function public.leave_game to service_role;

-- ---------------------------------------------------------------------------
-- is_ready toggle: the one game_players mutation safe to let clients write
-- directly. Column-level GRANT restricts the SET list to just this column
-- (a client cannot smuggle a stack/status/seat_number change into the same
-- UPDATE), and RLS restricts the row to the caller's own, non-left membership.
-- ---------------------------------------------------------------------------

create policy "players can toggle their own ready state"
  on public.game_players for update
  to authenticated
  using (user_id = auth.uid() and status <> 'left')
  with check (user_id = auth.uid() and status <> 'left');

grant update (is_ready) on public.game_players to authenticated;
