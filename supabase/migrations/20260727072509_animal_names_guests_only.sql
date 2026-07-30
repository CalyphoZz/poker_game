-- The random animal-name default should only apply to guest sessions
-- (Supabase Anonymous Auth). A real, identified account (email/password --
-- not built yet, but this trigger needs to already be forward-compatible)
-- should default to something derived from their own identity instead of a
-- random animal, since an identified account is meant to track recognizable
-- stats over time rather than play under a throwaway name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adjectives text[] := array[
    'Swift', 'Clever', 'Brave', 'Lazy', 'Sneaky', 'Happy', 'Grumpy', 'Fuzzy',
    'Mighty', 'Silent', 'Jolly', 'Wild', 'Gentle', 'Fierce', 'Curious',
    'Bouncy', 'Sly', 'Bold', 'Chill', 'Zippy'
  ];
  v_animals text[] := array[
    'Fox', 'Panda', 'Owl', 'Wolf', 'Otter', 'Falcon', 'Bear', 'Tiger',
    'Rabbit', 'Koala', 'Eagle', 'Shark', 'Lynx', 'Raccoon', 'Beaver', 'Hawk',
    'Penguin', 'Dolphin', 'Moose', 'Badger'
  ];
  v_name text;
begin
  if new.is_anonymous then
    v_name := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
      || v_animals[1 + floor(random() * array_length(v_animals, 1))::int];
  else
    v_name := coalesce(nullif(split_part(new.email, '@', 1), ''), 'Joueur');
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_name);
  return new;
end;
$$;
