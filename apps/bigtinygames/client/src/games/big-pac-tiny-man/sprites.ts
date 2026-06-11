import { Graphics, Renderer, Texture } from 'pixi.js';

// PLACEHOLDER ART: 8x8 one-bit pixel patterns, same convention as the snake
// game — '#' pixels get the color, '.' pixels are transparent. Swap these (or
// replace patternTexture with a sprite-sheet loader) for custom art later.

export const PAC_OPEN = [
  '..####..',
  '.######.',
  '######..',
  '####....',
  '####....',
  '######..',
  '.######.',
  '..####..',
];

export const PAC_CLOSED = [
  '..####..',
  '.######.',
  '########',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
];

export const GHOST = [
  '..####..',
  '.######.',
  '########',
  '##.##.##',
  '##.##.##',
  '########',
  '########',
  '#.#..#.#',
];

export const PELLET = [
  '........',
  '..####..',
  '.######.',
  '.######.',
  '.######.',
  '.######.',
  '..####..',
  '........',
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
