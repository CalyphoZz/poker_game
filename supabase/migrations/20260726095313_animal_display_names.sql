-- Friendlier default pseudo than "Joueur-XXXXXX" -- a random
-- adjective+animal pair (e.g. "SwiftFox"). Not unique (display_name isn't a
-- unique column), which is fine for a casual display name; players can
-- still rename themselves via the create/join screens.
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
  v_name := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
    || v_animals[1 + floor(random() * array_length(v_animals, 1))::int];

  insert into public.profiles (id, display_name)
  values (new.id, v_name);
  return new;
end;
$$;
