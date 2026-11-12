import type { ItemTag } from './items.ts';

export type Species =
  | 'cat' | 'dog' | 'rabbit' | 'bear' | 'fox' | 'owl' | 'deer' | 'frog'
  | 'penguin' | 'koala' | 'duck' | 'hamster' | 'wolf' | 'squirrel';

export type Personality = 'cheerful' | 'lazy' | 'grumpy' | 'sporty' | 'artsy' | 'shy';

export interface VillagerDef {
  id: string;
  name: string;
  species: Species;
  personality: Personality;
  color: string;
  accent: string;
  catchphrase: string;
  likes: ItemTag[];
  loves: string[]; // specific item ids
  dislikes: ItemTag[];
  birthday: string; // MM-DD
}

export const VILLAGERS: VillagerDef[] = [
  { id: 'v_maple', name: 'Maple', species: 'squirrel', personality: 'cheerful', color: '#c46a2b', accent: '#f3d3a2', catchphrase: 'nutty!', likes: ['fruit', 'sweet'], loves: ['cherry', 'berry_pie'], dislikes: ['mineral'], birthday: '10-03' },
  { id: 'v_bruno', name: 'Bruno', species: 'bear', personality: 'lazy', color: '#8a5a3c', accent: '#d9b48f', catchphrase: 'mmhm', likes: ['meal', 'berry'], loves: ['fish_stew', 'berries'], dislikes: ['tool'], birthday: '02-14' },
  { id: 'v_pip', name: 'Pip', species: 'rabbit', personality: 'shy', color: '#f2efe8', accent: '#f6b6c4', catchphrase: 'hop-hop', likes: ['plant', 'sweet'], loves: ['flower', 'flower_crown'], dislikes: ['fish'], birthday: '04-21' },
  { id: 'v_rex', name: 'Rex', species: 'wolf', personality: 'grumpy', color: '#7d8590', accent: '#e1e4e8', catchphrase: 'hmph', likes: ['mineral', 'fish'], loves: ['fish_salmon', 'iron_ore'], dislikes: ['sweet'], birthday: '11-30' },
  { id: 'v_juno', name: 'Juno', species: 'cat', personality: 'artsy', color: '#3b3b48', accent: '#f4d35e', catchphrase: 'purrfect', likes: ['furniture', 'fish'], loves: ['fish_koi', 'lamp'], dislikes: ['mushroom'], birthday: '07-07' },
  { id: 'v_biscuit', name: 'Biscuit', species: 'dog', personality: 'sporty', color: '#d9a35b', accent: '#fff3dc', catchphrase: 'woof yeah', likes: ['meal', 'fruit'], loves: ['grilled_fish', 'apple'], dislikes: ['furniture'], birthday: '05-30' },
  { id: 'v_saffron', name: 'Saffron', species: 'fox', personality: 'cheerful', color: '#e46b2e', accent: '#fff7ee', catchphrase: 'yip!', likes: ['berry', 'clothing'], loves: ['cloudberry', 'straw_hat'], dislikes: ['wood'], birthday: '09-12' },
  { id: 'v_hoot', name: 'Professor Hoot', species: 'owl', personality: 'grumpy', color: '#8c6a4a', accent: '#efe0c4', catchphrase: 'indeed', likes: ['rare', 'mushroom'], loves: ['glowcap', 'fish_oarfish'], dislikes: ['meal'], birthday: '12-01' },
  { id: 'v_fawn', name: 'Fawn', species: 'deer', personality: 'shy', color: '#b07a4f', accent: '#f6e6d2', catchphrase: 'oh my', likes: ['plant', 'fruit'], loves: ['sapling', 'fruit_salad'], dislikes: ['fish'], birthday: '03-19' },
  { id: 'v_ribbit', name: 'Ribbit', species: 'frog', personality: 'lazy', color: '#5fae4a', accent: '#e8f5c8', catchphrase: 'croak', likes: ['fish', 'mushroom'], loves: ['mushroom_soup', 'fish_carp'], dislikes: ['clothing'], birthday: '06-15' },
  { id: 'v_waddle', name: 'Waddles', species: 'penguin', personality: 'sporty', color: '#2c3e50', accent: '#ffffff', catchphrase: 'brrrilliant', likes: ['fish', 'cozy'], loves: ['fish_herring', 'beanie'], dislikes: ['fruit'], birthday: '01-20' },
  { id: 'v_eucy', name: 'Eucy', species: 'koala', personality: 'lazy', color: '#9aa3a8', accent: '#e9eef0', catchphrase: 'zzz', likes: ['plant', 'cozy'], loves: ['picnic_table', 'herbs'], dislikes: ['tool'], birthday: '08-08' },
  { id: 'v_puddle', name: 'Puddle', species: 'duck', personality: 'cheerful', color: '#f5f0e1', accent: '#f2a03d', catchphrase: 'quackers', likes: ['fish', 'sweet'], loves: ['berries', 'fish_sardine'], dislikes: ['mineral'], birthday: '04-02' },
  { id: 'v_nibbles', name: 'Nibbles', species: 'hamster', personality: 'artsy', color: '#e8b47a', accent: '#fff4e0', catchphrase: 'squeak', likes: ['furniture', 'sweet'], loves: ['gnome', 'dates'], dislikes: ['fish'], birthday: '10-27' },
  { id: 'v_cinder', name: 'Cinder', species: 'cat', personality: 'sporty', color: '#e07b39', accent: '#fff1e2', catchphrase: 'let’s go', likes: ['fish', 'fruit'], loves: ['fish_tuna', 'banana'], dislikes: ['plant'], birthday: '07-24' },
  { id: 'v_tundra', name: 'Tundra', species: 'wolf', personality: 'shy', color: '#dfe6ee', accent: '#a6b8c9', catchphrase: 'awoo', likes: ['berry', 'cozy'], loves: ['cloudberry', 'mushroom_soup'], dislikes: ['meal'], birthday: '12-21' },
  { id: 'v_coco', name: 'Coco', species: 'rabbit', personality: 'sporty', color: '#6d4c3d', accent: '#f0d9c5', catchphrase: 'boing', likes: ['fruit', 'clothing'], loves: ['coconut', 'cap'], dislikes: ['mushroom'], birthday: '05-05' },
  { id: 'v_barley', name: 'Barley', species: 'bear', personality: 'artsy', color: '#c9a36b', accent: '#fff0d4', catchphrase: 'grand', likes: ['furniture', 'wood'], loves: ['bench', 'prickly_pear'], dislikes: ['fish'], birthday: '09-01' },
];

export function villagerDef(id: string): VillagerDef | undefined {
  return VILLAGERS.find((v) => v.id === id);
}

export const FRIENDSHIP_LEVELS = [
  { min: 0, name: 'Stranger' },
  { min: 10, name: 'Acquaintance' },
  { min: 30, name: 'Friend' },
  { min: 60, name: 'Good Friend' },
  { min: 100, name: 'Best Friend' },
] as const;

export function friendshipLevel(points: number): { level: number; name: string; next?: number } {
  let level = 0;
  for (let i = 0; i < FRIENDSHIP_LEVELS.length; i++) if (points >= FRIENDSHIP_LEVELS[i].min) level = i;
  return { level, name: FRIENDSHIP_LEVELS[level].name, next: FRIENDSHIP_LEVELS[level + 1]?.min };
}

export const FRIENDSHIP_MAX = 150;
export const FRIENDSHIP_TALK = 2;
export const FRIENDSHIP_GIFT_LOVE = 10;
export const FRIENDSHIP_GIFT_LIKE = 6;
export const FRIENDSHIP_GIFT_NEUTRAL = 2;
export const FRIENDSHIP_GIFT_DISLIKE = -4;
export const FRIENDSHIP_BIRTHDAY_BONUS = 10;

/** Dialogue is generated from personality + friendship + context. */
const LINES: Record<Personality, string[][]> = {
  cheerful: [
    ['Oh hi! I don’t think we’ve met. I’m {name}!', 'Isn’t this island just the best?'],
    ['Hey, you again! Every day here is an adventure, {cp}!', 'I saw a fish jump earlier. A big one!'],
    ['Yay, it’s {player}! You always brighten my day, {cp}!', 'Want to go stargazing tonight?'],
    ['{player}! I was hoping you’d stop by! I made up a song about you, {cp}!'],
    ['My best friend in the whole world! Seriously, {player}, {cp}!'],
  ],
  lazy: [
    ['Oh... hey. I’m {name}. I was napping.', 'Got any snacks?'],
    ['Mm, the breeze is nice today, {cp}.', 'I counted clouds. Lost count at three.'],
    ['{player}! Wanna nap under a tree later? It’s the best, {cp}.'],
    ['You know what goes great with friends? Snacks. You’re both, {cp}.'],
    ['Best buds forever, {player}. Like pillows and naps, {cp}.'],
  ],
  grumpy: [
    ['Hmph. Name’s {name}. Don’t trample my flowers.'],
    ['Oh, it’s you. ...Fine weather, I suppose, {cp}.'],
    ['You’re not so bad, {player}. Don’t let it go to your head, {cp}.'],
    ['I saved you a seat on the bench. Not that I was waiting, {cp}.'],
    ['...You’re my best friend, {player}. If you tell anyone, {cp}.'],
  ],
  sporty: [
    ['Yo! I’m {name}! Ready for a morning jog?'],
    ['Feel the burn, {cp}! Chopping wood counts as cardio!'],
    ['{player}! Race you to the dock! Ha, {cp}!'],
    ['My training buddy! Let’s do squats at sunrise, {cp}!'],
    ['Team {player} and {name}, unstoppable! {cp}!'],
  ],
  artsy: [
    ['Hello. I’m {name}. The light here is... inspiring.'],
    ['The colours this season are exquisite, {cp}.'],
    ['{player}, would you model for my next painting? {cp}.'],
    ['I painted your house today. From memory. {cp}.'],
    ['You are my muse, {player}. Truly, {cp}.'],
  ],
  shy: [
    ['Oh! Um... h-hi. I’m {name}...'],
    ['It’s... nice to see you, {cp}.'],
    ['I like it when you visit, {player}. {cp}...'],
    ['I wrote you a letter but was too nervous to send it, {cp}.'],
    ['You’re my best friend, {player}. I mean it, {cp}!'],
  ],
};

const WEATHER_LINES: Record<string, string> = {
  rain: 'I love the sound of rain on the roof.',
  storm: 'All this thunder! Stay safe out there.',
  snow: 'Snow! Let’s build a snowman later!',
  fog: 'So misty today... spooky!',
  sandstorm: 'Sand in my fur again. Ugh.',
  heatwave: 'It’s sooo hot. Need... shade...',
  clear: 'What a lovely day, huh?',
  cloudy: 'Clouds are just the sky’s pillows.',
};

export function villagerLine(
  def: VillagerDef,
  level: number,
  ctx: { player: string; weather: string; hour: number; seed: number; birthday: boolean },
): string {
  const pool = LINES[def.personality][Math.min(level, 4)];
  let line = pool[ctx.seed % pool.length];
  if (ctx.birthday) line = `It’s my birthday today! ${line}`;
  else if (ctx.seed % 3 === 0) line += ' ' + (WEATHER_LINES[ctx.weather] ?? '');
  else if (ctx.hour >= 21 || ctx.hour < 5) line += ' You’re up late!';
  return line
    .replaceAll('{name}', def.name)
    .replaceAll('{player}', ctx.player)
    .replaceAll('{cp}', def.catchphrase)
    .trim();
}
