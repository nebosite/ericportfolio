// The lobby reads this list — add a new game folder under src/games/ and
// register it here to get a cabinet on the home page.

export interface GameMeta {
  id: string;
  title: string;
  blurb: string;
  path: string;
  status: "ready" | "construction";
}

export const GAMES: GameMeta[] = [
  {
    id: "big-pac-tiny-man",
    title: "BIG PAC TINY MAN",
    blurb: "Endless donut holes.",
    path: "/big-pac-tiny-man",
    status: "ready",
  },
  {
    id: "big-pipe-tiny-dream",
    title: "BIG PIPE TINY DREAM",
    blurb: "So much pipe, so little time.",
    path: "/big-pipe-tiny-dream",
    status: "ready",
  },
  {
    id: "snake",
    title: "BIG TINY SNAKE",
    blurb: "Snakes. Why did it have to be snakes?",
    path: "/snake",
    status: "ready",
  },
  {
    id: "big-aster-tiny-oids",
    title: "BIG ASTER TINY OIDS",
    blurb: "That's no moon. It's 12,000 moons.",
    path: "/big-aster-tiny-oids",
    status: "ready",
  },
  {
    id: "big-space-tiny-invaders",
    title: "BIG SPACE TINY INVADERS",
    blurb: "Thousands of them. One tiny you.",
    path: "/big-space-tiny-invaders",
    status: "ready",
  },
];
