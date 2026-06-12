import { Assets, Texture } from 'pixi.js';
import pacOpenUrl from './assetts/sprites/pac-open.png';
import pacClosedUrl from './assetts/sprites/pac-closed.png';
import ghostUrl from './assetts/sprites/ghost.png';
import ghostFrightenedUrl from './assetts/sprites/ghost-frightened.png';
import ghostEyesUrl from './assetts/sprites/ghost-eyes.png';
import pelletUrl from './assetts/sprites/pellet.png';
import fruitUrl from './assetts/sprites/fruit.png';

// Every gameplay graphic is an editable PNG checked into this game's
// assetts/sprites/ folder at its real arcade size (Pac 13x13, ghosts 14x15,
// pellet 14x14, fruit 13x13). Repaint them in any pixel editor to reskin the
// game — nothing is generated. Vite bundles them via the imports above.
// (The thousands of tiny dots and the maze walls stay code-drawn geometry.)

export interface SpriteTextures {
  pacOpen: Texture;
  pacClosed: Texture;
  ghost: Texture; // white body — the engine tints it per ghost
  ghostFrightened: Texture; // blue, drawn untinted
  ghostEyes: Texture; // eyes-only, shown while running home after being eaten
  pellet: Texture;
  fruit: Texture;
}

const SPRITE_URLS: Record<keyof SpriteTextures, string> = {
  pacOpen: pacOpenUrl,
  pacClosed: pacClosedUrl,
  ghost: ghostUrl,
  ghostFrightened: ghostFrightenedUrl,
  ghostEyes: ghostEyesUrl,
  pellet: pelletUrl,
  fruit: fruitUrl,
};

/** Load every sprite PNG with nearest-neighbor scaling (crisp pixel art). */
export async function loadSpriteTextures(): Promise<SpriteTextures> {
  const entries = await Promise.all(
    (Object.keys(SPRITE_URLS) as Array<keyof SpriteTextures>).map(async (key) => {
      const texture: Texture = await Assets.load(SPRITE_URLS[key]);
      texture.source.scaleMode = 'nearest';
      return [key, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as SpriteTextures;
}
