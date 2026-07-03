import { useState } from "react";
import TitleScreen from "../components/TitleScreen";
import PaintApp from "../components/PaintApp";

// PixelWhimsy is a two-state toy: a grown-up title screen, and the full-screen
// child sandbox. Start requests fullscreen (kiosk) on the user gesture; exiting
// the sandbox drops back out of fullscreen and back to the title.
//
// The "playing" flag is persisted in sessionStorage so a reload (a child hitting
// F5) keeps them in the drawing screen rather than dropping back to the title's
// grown-up controls. Fullscreen can't be re-entered without a gesture, so after
// a reload they stay in the sandbox, just windowed.

const PLAY_KEY = "pw_playing";

function readPlaying(): boolean {
  try {
    return sessionStorage.getItem(PLAY_KEY) === "1";
  } catch {
    return false;
  }
}

function writePlaying(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(PLAY_KEY, "1");
    else sessionStorage.removeItem(PLAY_KEY);
  } catch {
    /* storage unavailable — state just won't survive a reload */
  }
}

export default function HomePage() {
  const [playing, setPlaying] = useState(readPlaying);

  const start = async () => {
    // Fill the screen to hide browser chrome, then enter the sandbox. Awaiting
    // fullscreen means PaintApp mounts at the fullscreen size, so the drawing
    // buffer is sized correctly. Best-effort: some browsers/devices refuse
    // fullscreen — play proceeds either way.
    try {
      const req = document.documentElement.requestFullscreen?.();
      if (req) await req;
    } catch {
      /* fullscreen refused — play windowed */
    }
    writePlaying(true);
    setPlaying(true);
  };

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    writePlaying(false);
    setPlaying(false);
  };

  return playing ? <PaintApp onExit={exit} /> : <TitleScreen onStart={start} />;
}
