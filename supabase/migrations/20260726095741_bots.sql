-- Bots let the host test/practice without needing a second device. A bot is
-- a genuine auth.users row (created via the admin API from the add-bot Edge
-- Function, using supabase.auth.admin.createUser()) so it flows through the
-- exact same profiles/game_players/hand_players machinery as a real player
-- -- no special-casing anywhere else in the schema or the engine wiring.
-- is_bot/bot_difficulty are the only markers that distinguish it.
alter table public.game_players
  add column is_bot boolean not null default false,
  add column bot_difficulty text check (bot_difficulty in ('easy', 'medium', 'hard'));

-- Seats a bot that already has a profiles row (created by the Edge Function
-- via the admin API, which triggers handle_new_user() same as any signup).
-- Only usable pre-hand (status='lobby') -- adding a bot mid-hand would need
-- to slot into an already-dealt hand, which isn't supported.
create or replace function public.add_bot_to_game(
  p_game_id uuid,
  p_bot_user_id uuid,
  p_difficulty text
)
returns public.game_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games;
  v_seated_count int;
  v_next_seat smallint;
  v_result public.game_players;
begin
  if p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'Invalid bot difficulty' using errcode = 'P0005';
  end if;

  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;
  if v_game.status <> 'lobby' then
    raise exception 'Bots can only be added before the game starts' using errcode = 'P0006';
  end if;

  select count(*) into v_seated_count
  from public.game_players
  where game_id = p_game_id and status in ('seated', 'sitting_out');

  if v_seated_count >= v_game.max_players then
    raise exception 'This game is full' using errcode = 'P0003';
  end if;

  select min(s) into v_next_seat
  from generate_series(1, v_game.max_players) as s
  where s not in (
    select seat_number from public.game_players
    where game_id = p_game_id and seat_number is not null
  );

  insert into public.game_players (
    game_id, user_id, seat_number, stack, status, is_ready, is_bot, bot_difficulty
  ) values (
    p_game_id, p_bot_user_id, v_next_seat, v_game.starting_stack, 'seated', true, true, p_difficulty
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.add_bot_to_game from public, anon, authenticated;
grant execute on function public.add_bot_to_game to service_role;

-- authenticated already can't write game_players directly (no grant beyond
-- is_ready, see init_schema.sql), so is_bot/bot_difficulty need no extra
-- protection -- but they DO need to be visible for the lobby/table UI to
-- show a bot indicator, which the existing `grant select ... to
-- authenticated` on game_players already covers for all columns.
