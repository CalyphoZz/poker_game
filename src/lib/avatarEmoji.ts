// Guests get a random "AdjectiveAnimal" display name (see the
// animal_names_guests_only migration and add-bot's name generator) -- this
// maps the animal suffix to an emoji so the table can show a fun avatar
// without needing real profile photos. A real, identified account (email-
// derived name, not from that generator) just won't match anything here and
// falls back to its initial letter.
const ANIMAL_EMOJI: Record<string, string> = {
  Fox: '🦊',
  Panda: '🐼',
  Owl: '🦉',
  Wolf: '🐺',
  Otter: '🦦',
  Falcon: '🦅',
  Bear: '🐻',
  Tiger: '🐯',
  Rabbit: '🐰',
  Koala: '🐨',
  Eagle: '🦅',
  Shark: '🦈',
  Lynx: '🐆',
  Raccoon: '🦝',
  Beaver: '🦫',
  Hawk: '🦅',
  Penguin: '🐧',
  Dolphin: '🐬',
  Moose: '🫎',
  Badger: '🦡',
};

const ANIMAL_NAMES = Object.keys(ANIMAL_EMOJI);

export function getAvatarEmoji(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const match = ANIMAL_NAMES.find((animal) => displayName.endsWith(animal));
  return match ? ANIMAL_EMOJI[match] : null;
}
