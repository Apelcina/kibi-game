// The trait model: one continuous affinity per element, 0 (none) to 1 (maxed).
// This is the thing "feeding an item" will nudge later — for now, sliders stand
// in for that so the mapping from trait -> look can be tuned without a feeding
// system attached yet.
//
// Each element also names an `effect` — a distinct visual treatment beyond a
// flat color tint, dispatched in chao.js. The point is that elements should
// read as different *kinds* of change (a prop, a silhouette change, a body
// language change), not just different paint jobs on the same shape.

export const ELEMENTS = ['fire', 'water', 'nature', 'speed', 'fairy'];

export const ELEMENT_INFO = {
  fire: { label: 'Fire', color: 0xe8432c, accent: 0xffb020, effect: 'orb' },
  water: { label: 'Water', color: 0x2f7fd6, accent: 0xbfe9ff, effect: 'glossy' },
  nature: { label: 'Nature', color: 0x4caa3f, accent: 0x9be36b, effect: 'sprout' },
  speed: { label: 'Speed', color: 0xf2c53d, accent: 0xfff2b0, effect: 'aero' },
  fairy: { label: 'Fairy', color: 0xff6fc9, accent: 0xffd1ec, effect: 'wings' },
};

export const NEUTRAL_COLOR = 0xd8d2c4;

export const AGES = [1, 2, 3];
// Cube shape shelved for now (its "flop" animation moved to the sphere's
// idle instead — see chao.js update()); still supported internally by
// primitiveGeometry() in case it's revisited, just not offered in the UI.
export const BODY_SHAPES = ['sphere'];

export function createDefaultTraits() {
  const traits = {};
  for (const el of ELEMENTS) traits[el] = 0;
  return traits;
}
