-- Creates a game and seats the host atomically in a single transaction,
-- including the invite-code collision retry loop. This is called exclusively
-- from the create-game Edge Function's service-role client -- never exposed
-- to authenticated/anon, since it takes the host's identity as a raw
-- parameter rather than deriving it from auth.uid().
create or replace function public.create_game_with_host(
  p_host_user_id uuid,
  p_small_blind bigint,
  p_big_blind bigint,
  p_starting_stack bigint,
  p_max_players smallint,
  p_turn_duration_seconds int
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
        starting_stack, max_players, turn_duration_seconds
      ) values (
        v_invite_code, p_host_user_id, p_small_blind, p_big_blind,
        p_starting_stack, p_max_players, p_turn_duration_seconds
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
