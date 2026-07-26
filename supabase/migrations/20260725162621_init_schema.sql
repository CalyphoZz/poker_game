-- M1 schema: profiles, games, game_players.
-- All gameplay mutations (seating, stacks, ready state, game config) happen
-- exclusively through Edge Functions using the service role, which bypasses
-- RLS by design -- see architecture plan section 3. Client-side RLS below
-- therefore only ever grants SELECT, never INSERT/UPDATE/DELETE, to the
-- `authenticated` role (this covers both anonymous and upgraded accounts,
-- since Supabase Anonymous Auth sessions are `authenticated`, not `anon`).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_key text not null default 'default',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are visible to any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Populates `profiles` the moment a Supabase Auth user is created -- identical
-- code path whether the session came from signInAnonymously() or a later
-- linked email identity, so a guest's pseudo/avatar survive that upgrade.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, 'Joueur-' || substr(new.id::text, 1, 6));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  host_user_id uuid not null references public.profiles (id),
  status text not null default 'lobby' check (status in ('lobby', 'active', 'paused', 'ended')),
  -- Only 'cash' is implemented in the MVP; 'tournament' and the two reserved
  -- columns below exist so a future tournament mode needs no schema rewrite.
  game_mode text not null default 'cash' check (game_mode in ('cash', 'tournament')),
  max_players smallint not null default 8 check (max_players between 2 and 10),
  small_blind bigint not null check (small_blind > 0),
  big_blind bigint not null check (big_blind > small_blind),
  starting_stack bigint not null check (starting_stack > 0),
  turn_duration_seconds int not null default 25 check (turn_duration_seconds > 0),
  blind_increase_interval_minutes int,
  current_blind_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.games enable row level security;

-- ---------------------------------------------------------------------------
-- game_players
-- ---------------------------------------------------------------------------

create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  -- Nullable: cleared when a player leaves so their seat can be reassigned.
  -- A standard unique constraint treats multiple NULLs as distinct, so this
  -- does not conflict with other left/never-seated players in the same game.
  seat_number smallint,
  stack bigint not null default 0,
  -- A busted player (stack = 0) simply stays 'seated' and is excluded from
  -- dealing until they rebuy -- there is no separate spectator role.
  -- A player who leaves keeps their row (status='left', seat_number=null) so
  -- the same identity/stack can be reactivated on rejoin -- see join-game.
  status text not null default 'seated' check (status in ('seated', 'sitting_out', 'left')),
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (game_id, seat_number),
  unique (game_id, user_id)
);

alter table public.game_players enable row level security;

-- security definer so it can read game_players from within a game_players
-- RLS policy without recursing back through RLS itself.
create or replace function public.is_game_member(p_game_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.game_players
    where game_id = p_game_id and user_id = p_user_id and status <> 'left'
  );
$$;

create policy "games are visible to their members"
  on public.games for select
  to authenticated
  using (public.is_game_member(id, auth.uid()));

create policy "game members can see all seats in their game"
  on public.game_players for select
  to authenticated
  using (public.is_game_member(game_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
-- This project's config.toml does not set auto_expose_new_tables, which
-- matches the current Supabase default of NOT auto-granting newly created
-- tables to ANY API role, service_role included. RLS policies alone are not
-- sufficient without the underlying GRANT -- Postgres checks table-level
-- privileges first, then RLS filters rows within what the GRANT allows.
-- `authenticated` only gets the narrow set of operations its RLS policies
-- above actually rely on. `service_role` already bypasses RLS by Supabase
-- convention, so restricting its grants further would add no real security
-- (it is never client-facing) -- it gets full privileges on every gameplay
-- table so Edge Functions can read/write freely via the admin client.

grant select, update on public.profiles to authenticated;
grant select on public.games to authenticated;
grant select on public.game_players to authenticated;

grant all on public.profiles, public.games, public.game_players to service_role;
