-- Per-hand tables. Engine PlayerId == profiles.id (auth.uid()) throughout --
-- within a single hand a user_id already uniquely identifies a seat, so
-- there is no need for a separate hand-scoped player-id indirection.

create table public.hands (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  hand_number int not null,
  dealer_seat smallint not null,
  small_blind_seat smallint not null,
  big_blind_seat smallint not null,
  -- Dealer's user_id, kept alongside dealer_seat: rotation for the *next*
  -- hand looks the previous dealer up by id (see blinds.ts), which stays
  -- correct even if seat numbers get reused after someone leaves and a new
  -- player joins that same seat.
  dealer_user_id uuid not null references public.profiles (id),
  -- Same reasoning as dealer_user_id -- stored directly rather than derived
  -- from *_seat, so reconstructing HandState.smallBlindIndex/bigBlindIndex
  -- for a player-action call never depends on a seat-number lookup.
  small_blind_user_id uuid not null references public.profiles (id),
  big_blind_user_id uuid not null references public.profiles (id),
  status text not null default 'in_progress' check (status in ('in_progress', 'complete')),
  current_street text not null default 'preflop' check (current_street in ('preflop', 'flop', 'turn', 'river')),
  board_cards text[] not null default '{}',
  pot_total bigint not null default 0,
  current_bet bigint not null default 0,
  min_raise bigint not null default 0,
  -- Internal engine bookkeeping (see betting.ts's round-closure algorithm)
  -- persisted verbatim so a later player-action call can reconstruct the
  -- exact HandState the engine last returned, not just derived DB columns.
  actions_remaining_this_street int not null default 0,
  current_turn_user_id uuid references public.profiles (id),
  turn_deadline timestamptz,
  last_aggressor_user_id uuid references public.profiles (id),
  winners jsonb,
  -- Optimistic concurrency guard. Edge Functions read this row over
  -- PostgREST (a plain HTTP call, not a held transaction), compute the next
  -- state in TypeScript via the poker-engine package, then write back with
  -- `WHERE state_version = <value just read>`. If that UPDATE affects 0
  -- rows, a concurrent action beat us to it -- the caller gets a 409 and
  -- retries against the fresh state, instead of ever double-applying an
  -- action or silently overwriting a newer state.
  state_version bigint not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (game_id, hand_number)
);

create table public.hand_players (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references public.hands (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  seat_number smallint not null,
  starting_stack bigint not null,
  stack bigint not null,
  committed_this_street bigint not null default 0,
  committed_total bigint not null default 0,
  is_folded boolean not null default false,
  is_all_in boolean not null default false,
  final_stack bigint,
  net_result bigint,
  unique (hand_id, user_id)
);

-- The one genuinely secret table -- never added to the Realtime publication.
-- Clients fetch their own cards with a plain authenticated SELECT, gated by
-- RLS below, never by a postgres_changes broadcast.
create table public.hand_hole_cards (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references public.hands (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  cards text[] not null check (array_length(cards, 1) = 2),
  unique (hand_id, user_id)
);

-- Remaining undealt cards between player-action calls (needed to deal the
-- next street). Deliberately has NO grant to `authenticated`/`anon` at all --
-- unlike every other table here, this isn't "select-restricted by RLS", it's
-- invisible to the API entirely, because even a correctly-RLS-scoped read of
-- one's "own" row would still leak the whole table's future community cards
-- (and, by elimination, other players' hole cards) to that player.
create table public.hand_deck_state (
  hand_id uuid primary key references public.hands (id) on delete cascade,
  remaining_deck text[] not null
);

create table public.hand_actions (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references public.hands (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  street text not null check (street in ('preflop', 'flop', 'turn', 'river')),
  action_type text not null check (
    action_type in ('post_sb', 'post_bb', 'fold', 'check', 'call', 'raise', 'all_in')
  ),
  amount bigint not null default 0,
  sequence_number int not null,
  -- Idempotency key: a client retry or double-tap can never apply twice.
  client_action_id uuid not null,
  created_at timestamptz not null default now(),
  unique (hand_id, client_action_id),
  unique (hand_id, sequence_number)
);

create table public.side_pots (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references public.hands (id) on delete cascade,
  pot_number int not null,
  amount bigint not null,
  eligible_user_ids uuid[] not null,
  winner_user_ids uuid[],
  unique (hand_id, pot_number)
);

alter table public.hands enable row level security;
alter table public.hand_players enable row level security;
alter table public.hand_hole_cards enable row level security;
alter table public.hand_actions enable row level security;
alter table public.side_pots enable row level security;
alter table public.hand_deck_state enable row level security;

create or replace function public.is_hand_member(p_hand_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.hands h
    where h.id = p_hand_id and public.is_game_member(h.game_id, p_user_id)
  );
$$;

create policy "hands are visible to their game's members"
  on public.hands for select
  to authenticated
  using (public.is_game_member(game_id, auth.uid()));

create policy "hand_players are visible to the hand's members"
  on public.hand_players for select
  to authenticated
  using (public.is_hand_member(hand_id, auth.uid()));

create policy "hand_actions are visible to the hand's members"
  on public.hand_actions for select
  to authenticated
  using (public.is_hand_member(hand_id, auth.uid()));

create policy "side_pots are visible to the hand's members"
  on public.side_pots for select
  to authenticated
  using (public.is_hand_member(hand_id, auth.uid()));

create policy "own hole cards always visible"
  on public.hand_hole_cards for select
  to authenticated
  using (user_id = auth.uid());

create policy "hole cards visible to hand members once the hand is complete"
  on public.hand_hole_cards for select
  to authenticated
  using (
    exists (
      select 1 from public.hands h
      where h.id = hand_hole_cards.hand_id
        and h.status = 'complete'
        and public.is_game_member(h.game_id, auth.uid())
    )
  );

-- Same reasoning as the games/game_players grants: no auto-exposure by
-- default, authenticated gets SELECT only, service_role gets full access
-- for the Edge Functions that own every write to these tables.
grant select on public.hands to authenticated;
grant select on public.hand_players to authenticated;
grant select on public.hand_hole_cards to authenticated;
grant select on public.hand_actions to authenticated;
grant select on public.side_pots to authenticated;
-- Deliberately no grant at all on hand_deck_state for authenticated/anon.

grant all on public.hands, public.hand_players, public.hand_hole_cards,
  public.hand_actions, public.side_pots, public.hand_deck_state to service_role;

-- hand_hole_cards and hand_deck_state are deliberately excluded here.
alter publication supabase_realtime add table public.hands;
alter publication supabase_realtime add table public.hand_players;
alter publication supabase_realtime add table public.hand_actions;
alter publication supabase_realtime add table public.side_pots;
