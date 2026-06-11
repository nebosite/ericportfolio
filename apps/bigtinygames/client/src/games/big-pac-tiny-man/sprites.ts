import { Assets, Graphics, Renderer, Texture } from 'pixi.js';

// Pac, the ghosts, and fruit are loaded from editable PNGs in public/sprites/
// at their real arcade sizes (Pac 13x13, ghosts 14x15, fruit 13x13). Drop in
// your own art with the same filenames to reskin the game. The power pellet and
// dots stay as code-drawn graphics (there can be tens of thousands of dots, so
// they're batched rather than textured).

export interface SpriteTextures {
  pacOpen: Texture;
  pacClosed: Texture;
  ghost: Texture; // white body — the engine tints it per ghost
  ghostFrightened: Texture; // blue, drawn untinted
  fruit: Texture;
}

const SPRITE_FILES: Record<keyof SpriteTextures, string> = {
  pacOpen: '/sprites/pac-open.png',
  pacClosed: '/sprites/pac-closed.png',
  ghost: '/sprites/ghost.png',
  ghostFrightened: '/sprites/ghost-frightened.png',
  fruit: '/sprites/fruit.png',
};

/** Load every sprite PNG with nearest-neighbor scaling (crisp pixel art). */
export async function loadSpriteTextures(): Promise<SpriteTextures> {
  const entries = await Promise.all(
    (Object.keys(SPRITE_FILES) as Array<keyof SpriteTextures>).map(async (key) => {
      const texture: Texture = await Assets.load(SPRITE_FILES[key]);
      texture.source.scaleMode = 'nearest';
      return [key, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as SpriteTextures;
}

// Power pellet: a fat pulsing dot, drawn into a GPU texture once.
const PELLET = [
  '..####..',
  '.######.',
  '########',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
];

/** Bake a pixel pattern into a GPU texture (1 world unit = 1 device pixel). */
export function patternTexture(renderer: Renderer, pattern: string[], color: number): Texture {
  const g = new Graphics();
  for (let row = 0; row < pattern.length; row++) {
    for (let col = 0; col < pattern[row].length; col++) {
      if (pattern[row][col] === '#') g.rect(col, row, 1, 1);
    }
  }
  g.fill(color);
  const texture = renderer.generateTexture(g);
  texture.source.scaleMode = 'nearest';
  g.destroy();
  return texture;
}

export function pelletTexture(renderer: Renderer, color: number): Texture {
  return patternTexture(renderer, PELLET, color);
}
