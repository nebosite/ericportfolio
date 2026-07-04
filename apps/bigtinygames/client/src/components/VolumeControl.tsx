import { useEffect, useState } from "react";
import { getVolume, setVolume, subscribeVolume } from "../lib/volume";
import styles from "./VolumeControl.module.css";

// A master-volume slider for a game's title screen. Reads/writes the shared
// volume in lib/volume, so every game's sound effects (and every game's copy of
// this control) stay in sync.
export default function VolumeControl() {
  const [vol, setVol] = useState(getVolume());
  useEffect(() => subscribeVolume(setVol), []);

  const pct = Math.round(vol * 100);
  const muted = vol <= 0;

  return (
    <div className={styles.volume}>
      <button
        type="button"
        className={styles.mute}
        onClick={() => setVolume(muted ? 1 : 0)}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? "🔇" : vol < 0.5 ? "🔉" : "🔊"}
      </button>
      <span className={styles.label}>VOLUME</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        className={styles.slider}
        aria-label="Volume"
      />
      <span className={styles.pct}>{muted ? "MUTED" : `${pct}%`}</span>
    </div>
  );
}
