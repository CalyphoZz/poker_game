-- Joins (or rejoins) a game by invite code, atomically. Called exclusively
-- from the join-game Edge Function's service-role client, which derives
-- p_user_id from the caller's verified JWT -- never exposed directly to
-- authenticated/anon, since seat allocation and capacity checks must not be
-- something a client can bypass by writing game_players directly.
--
-- Locking the `games` row (FOR UPDATE) serializes concurrent joins to the
-- same game, so two simultaneous joiners can never race for the same seat
-- or both squeeze in past max_players.
create or replace function public.join_game_by_code(
  p_invite_code text,
  p_user_id uuid
)
returns public.game_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games;
  v_existing public.game_players;
  v_existing_found boolean := false;
  v_seated_count int;
  v_next_seat smallint;
  v_result public.game_players;
begin
  select * into v_game
  from public.games
  where invite_code = upper(p_invite_code)
  for update;

  if not found then
    raise exception 'No game found for that invite code' using errcode = 'P0002';
  end if;

  if v_game.status = 'ended' then
    raise exception 'This game has ended' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.game_players
  where game_id = v_game.id and user_id = p_user_id
  for update;
  v_existing_found := found;

  -- Idempotent: already an active member, return the existing seat as-is.
  if v_existing_found and v_existing.status <> 'left' then
    return v_existing;
  end if;

  select count(*) into v_seated_count
  from public.game_players
  where game_id = v_game.id and status in ('seated', 'sitting_out');

  if v_seated_count >= v_game.max_players then
    raise exception 'This game is full' using errcode = 'P0003';
  end if;

  select min(s) into v_next_seat
  from generate_series(1, v_game.max_players) as s
  where s not in (
    select seat_number from public.game_players
    where game_id = v_game.id and seat_number is not null
  );

  if v_existing_found then
    update public.game_players
    set seat_number = v_next_seat, status = 'seated', is_ready = false, left_at = null
    where id = v_existing.id
    returning * into v_result;
  else
    insert into public.game_players (game_id, user_id, seat_number, stack, status, is_ready)
    values (v_game.id, p_user_id, v_next_seat, v_game.starting_stack, 'seated', false)
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

revoke all on function public.join_game_by_code from public, anon, authenticated;
grant execute on function public.join_game_by_code to service_role;
