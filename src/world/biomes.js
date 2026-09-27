// Biome ids of the newer terrain (the first ten are the first generator's) and its sea level.

import { BIOME, BIOME_NAMES } from './generator.js';

export const SEA2 = 63;
export const BIOME2 = { ...BIOME, JUNGLE: 10, SAVANNA: 11, SWAMP: 12, BADLANDS: 13, CHERRY: 14, DARK_FOREST: 15 };
export const BIOME2_NAMES = [...BIOME_NAMES, 'Jungle', 'Savanna', 'Swamp', 'Badlands', 'Cherry Grove', 'Dark Forest'];
