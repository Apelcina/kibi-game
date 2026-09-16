import { defineConfig } from 'vite';

// Local dev serves from the root ("/") as usual; production builds are
// embedded on kisetsu.space under /games/kibi-game/, so asset URLs need
// that prefix baked in — same pattern as the site's other embedded game
// (yes-captain).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/games/kibi-game/' : '/',
}));
