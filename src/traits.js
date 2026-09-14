// The trait model: one continuous affinity per element, 0 (none) to 1 (maxed).
// This is the thing "feeding an item" will nudge later — for now, sliders stand
// in for that so the mapping from trait -> look can be tuned without a feeding
// system attached yet.

export const ELEMENTS = ['fire', 'water', 'nature'];

export const ELEMENT_INFO = {
  fire: { label: 'Fire', color: 0xff6a3d },
  water: { label: 'Water', color: 0x4fa8ff },
  nature: { label: 'Nature', color: 0x6bd66b },
};

export const NEUTRAL_COLOR = 0xd8d2c4;

export function createDefaultTraits() {
  const traits = {};
  for (const el of ELEMENTS) traits[el] = 0;
  return traits;
}
