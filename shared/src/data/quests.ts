import type { BuildingType } from './buildings.ts';

export type Goal =
  | { kind: 'craft'; item: string; label: string }
  | { kind: 'build'; building: BuildingType; count?: number; label: string }
  | { kind: 'villagers'; count: number; label: string };

export interface Chapter {
  id: number;
  title: string;
  /** Target island day to finish by (day 1 = founding day). */
  byDay: number;
  intro: string;
  goals: Goal[];
  reward: { coins: number; items?: Record<string, number> };
}

export const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: 'Day One: Make Camp',
    byDay: 1,
    intro: 'You’ve landed! Gather wood, stones and fibre, craft some basic tools and set up camp before nightfall.',
    goals: [
      { kind: 'craft', item: 'stone_axe', label: 'Craft a Stone Axe' },
      { kind: 'craft', item: 'shovel', label: 'Craft a Shovel' },
      { kind: 'craft', item: 'fishing_rod', label: 'Craft a Fishing Rod' },
      { kind: 'build', building: 'tent', label: 'Pitch a Tent' },
      { kind: 'build', building: 'campfire', label: 'Light a Campfire' },
      { kind: 'build', building: 'workbench', label: 'Build a Workbench' },
    ],
    reward: { coins: 300, items: { sapling: 3 } },
  },
  {
    id: 2,
    title: 'First Week: A Home of Your Own',
    byDay: 7,
    intro: 'Camp life is fun, but a real house would be nicer. Gather clay from rocks and build your starter house.',
    goals: [{ kind: 'build', building: 'cabin', label: 'Build your Starter House' }],
    reward: { coins: 1000, items: { bench: 1, lamp: 1 } },
  },
  {
    id: 3,
    title: 'First Month: A Little Village',
    byDay: 30,
    intro: 'It’s getting lonely. Build a Town Hall and three houses so villagers can move in.',
    goals: [
      { kind: 'build', building: 'town_hall', label: 'Build the Town Hall' },
      { kind: 'build', building: 'villager_house', count: 3, label: 'Build 3 Villager Houses' },
      { kind: 'villagers', count: 3, label: 'Welcome 3 villagers' },
    ],
    reward: { coins: 3000, items: { picnic_table: 1 } },
  },
  {
    id: 4,
    title: 'Month Two: A Thriving Town',
    byDay: 60,
    intro: 'Word is spreading! Grow to seven villagers and open every shop in town.',
    goals: [
      { kind: 'villagers', count: 7, label: 'Grow to 7 villagers' },
      { kind: 'build', building: 'post_office', label: 'Open the Post Office' },
      { kind: 'build', building: 'travel_agent', label: 'Open the Travel Agent' },
      { kind: 'build', building: 'clothing_shop', label: 'Open the Clothing Shop' },
      { kind: 'build', building: 'restaurant', label: 'Open the Restaurant' },
      { kind: 'build', building: 'tool_store', label: 'Open the Tool Store' },
      { kind: 'build', building: 'furniture_store', label: 'Open the Furniture Store' },
    ],
    reward: { coins: 10000, items: { gnome: 1, flower_crown: 1 } },
  },
];

export interface ProgressInput {
  crafted: Record<string, number>;
  /** Completed buildings by type. */
  built: Partial<Record<BuildingType, number>>;
  villagers: number;
}

export function goalDone(g: Goal, p: ProgressInput): boolean {
  switch (g.kind) {
    case 'craft':
      return (p.crafted[g.item] ?? 0) > 0;
    case 'build':
      return (p.built[g.building] ?? 0) >= (g.count ?? 1);
    case 'villagers':
      return p.villagers >= g.count;
  }
}

export function chapterDone(c: Chapter, p: ProgressInput): boolean {
  return c.goals.every((g) => goalDone(g, p));
}
