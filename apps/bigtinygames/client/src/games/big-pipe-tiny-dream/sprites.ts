import crossUrl from "./assets/sprites/cross.png";
import elbowUrl from "./assets/sprites/elbow.png";
import pipeUrl from "./assets/sprites/pipe.png";
import startUrl from "./assets/sprites/start.png";
import terminusUrl from "./assets/sprites/terminus.png";

// The pipe tiles are editable 40x40 PNGs in this game's assets/sprites/ folder,
// drawn at their native orientation (documented below). The render layer rotates
// them per tile to match the tile's logical openings — reskin by replacing the
// PNGs, nothing is generated. Vite bundles them via the imports above.
//
// Native orientations (as authored):
//   pipe     — vertical straight (N–S)
//   elbow    — opening east + south
//   cross    — crossover, horizontal pipe on top
//   start    — spring, opening east
//   terminus — drain, opening east

export type SpriteName = "cross" | "elbow" | "pipe" | "start" | "terminus";

const SPRITE_URLS: Record<SpriteName, string> = {
  cross: crossUrl,
  elbow: elbowUrl,
  pipe: pipeUrl,
  start: startUrl,
  terminus: terminusUrl,
};

export type SpriteImages = Record<SpriteName, HTMLImageElement>;

/** Load every sprite PNG as an Image; resolves once all have decoded. */
export function loadSprites(): Promise<SpriteImages> {
  const names = Object.keys(SPRITE_URLS) as SpriteName[];
  return Promise.all(
    names.map(
      (name) =>
        new Promise<[SpriteName, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([name, img]);
          img.onerror = reject;
          img.src = SPRITE_URLS[name];
        }),
    ),
  ).then((entries) => Object.fromEntries(entries) as SpriteImages);
}
