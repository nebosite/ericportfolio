// The lobby reads this list — add a new game folder under src/games/ and
// register it here to get a cabinet on the home page.

export interface GameMeta {
  id: string;
  title: string;
  blurb: string;
  path: string;
  status: 'ready' | 'construction';
}

export const GAMES: GameMeta[] = [
  {
    id: 'snake',
    title: 'BIG TINY SNAKE',
    blurb: 'One large field. One(?) tiny snake. How long can you last?',
    path: '/snake',
    status: 'ready',
  },
  {
    id: 'big-pac-tiny-man',
    title: 'BIG PAC TINY MAN',
    blurb: 'A labyrinth as big as your monitor and one very small man to feed.',
    path: '/big-pac-tiny-man',
    status: 'ready',
  },
];
