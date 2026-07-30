-- Two changes driven by a mobile-UX pass on the create flow:
--
-- 1. "Joueurs max" stops being a host-configurable setting -- the table
--    capacity is now a fixed technical ceiling (10), never shown as a choice
--    in the UI. create_game_with_host is recreated without p_max_players.
--
-- 2. Blinds now actually increase automatically on a timer (previously
--    blind_increase_interval_minutes/current_blind_level existed but nothing
--    ever read or advanced them) -- without that, it isn't really poker, per
--    explicit confirmation. next_blind_increase_at anchors the schedule:
--    NULL until the game's first hand starts (start-hand bootstraps it),
--    then start-hand doubles small_blind/big_blind and bumps
--    current_blind_level each time the deadline has passed, once per
--    elapsed interval, so an AFK table still catches up correctly instead of
--    only ever applying a single level no matter how long play was paused.

update public.games set blind_increase_interval_minutes = 10 where blind_increase_interval_minutes is null;

alter table public.games
  alter column blind_increase_interval_minutes set default 10,
  alter column blind_increase_interval_minutes set not null,
  add column next_blind_increase_at timestamptz;

drop function if exists public.create_game_with_host(uuid, bigint, bigint, bigint, smallint, int);

create or replace function public.create_game_with_host(
  p_host_user_id uuid,
  p_small_blind bigint,
  p_big_blind bigint,
  p_starting_stack bigint,
  p_turn_duration_seconds int,
  p_blind_increase_interval_minutes int
)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I/L
  v_invite_code text;
  v_game public.games;
  v_attempt int := 0;
  v_max_attempts constant int := 5;
begin
  loop
    v_attempt := v_attempt + 1;
    v_invite_code := '';
    for i in 1..6 loop
      v_invite_code := v_invite_code
        || substr(v_code_alphabet, 1 + floor(random() * length(v_code_alphabet))::int, 1);
    end loop;

    begin
      insert into public.games (
        invite_code, host_user_id, small_blind, big_blind,
        starting_stack, max_players, turn_duration_seconds,
        blind_increase_interval_minutes
      ) values (
        v_invite_code, p_host_user_id, p_small_blind, p_big_blind,
        p_starting_stack, 10, p_turn_duration_seconds,
        p_blind_increase_interval_minutes
      )
      returning * into v_game;

      exit;
    exception when unique_violation then
      if v_attempt >= v_max_attempts then
        raise exception 'Could not generate a unique invite code after % attempts', v_attempt;
      end if;
      -- otherwise loop again with a freshly generated code
    end;
  end loop;

  insert into public.game_players (game_id, user_id, seat_number, stack, status, is_ready)
  values (v_game.id, p_host_user_id, 1, p_starting_stack, 'seated', false);

  return v_game;
end;
$$;

revoke all on function public.create_game_with_host from public, anon, authenticated;
grant execute on function public.create_game_with_host to service_role;
