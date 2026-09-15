// The trait model: one continuous affinity per element, 0 (none) to 1 (maxed).
// This is the thing "feeding an item" will nudge later — for now, sliders stand
// in for that so the mapping from trait -> look can be tuned without a feeding
// system attached yet.
//
// Each element also names an `effect` — a distinct visual treatment beyond a
// flat color tint, dispatched in kibi.js. The point is that elements should
// read as different *kinds* of change (a prop, a silhouette change, a body
// language change), not just different paint jobs on the same shape.

export const ELEMENTS = ['fire', 'water', 'ice', 'nature', 'lightning', 'fairy', 'ground', 'dark'];

export const ELEMENT_INFO = {
  fire: { label: 'Fire', color: 0xe8432c, accent: 0xffb020, effect: 'orb' },
  water: { label: 'Water', color: 0x2f7fd6, accent: 0xbfe9ff, effect: 'webbed' },
  ice: { label: 'Ice', color: 0xa8e6f0, accent: 0xf0fdff, effect: 'gem' },
  nature: { label: 'Nature', color: 0x4caa3f, accent: 0x9be36b, effect: 'sprout' },
  lightning: { label: 'Lightning', color: 0xf2c53d, accent: 0xfff2b0, effect: 'aero' },
  fairy: { label: 'Fairy', color: 0xff6fc9, accent: 0xffd1ec, effect: 'wings' },
  ground: { label: 'Ground', color: 0x8b6b3d, accent: 0xd4b483, effect: 'bulk' },
  dark: { label: 'Dark', color: 0x3d2a52, accent: 0x8a5fc9, effect: 'horns' },
};

// How elements group in the color scheme (see kibi.js applyTraits) AND in
// the trait panel UI (see main.js) — one shared source of truth so the two
// never drift apart. Major = back/dominant color slot; Minor = front/belly
// accent slot; Misc = not part of the color scheme at all (fairy drives
// wings only).
export const MAJOR_ELEMENTS = ['fire', 'water', 'ground', 'dark'];
export const MINOR_ELEMENTS = ['nature', 'lightning', 'ice'];
export const MISC_ELEMENTS = ['fairy'];

export const NEUTRAL_COLOR = 0xd8d2c4;

export const AGES = [1, 2, 3];
// Cube shape shelved for now (its "flop" animation moved to the sphere's
// idle instead — see kibi.js update()); still supported internally by
// primitiveGeometry() in case it's revisited, just not offered in the UI.
export const BODY_SHAPES = ['sphere'];

export function createDefaultTraits() {
  const traits = {};
  for (const el of ELEMENTS) traits[el] = 0;
  return traits;
}
