import { useEffect } from "react";
import MarqueeTrack from "./MarqueeTrack";
import { exitFullscreen, keepScreenAwake } from "./pwa";
import { Settings } from "./settings";
import styles from "./HandsHighPage.module.css";

interface Props {
  message: string;
  settings: Settings;
  onExit: () => void;
}

/** Full-screen marquee: letters span the screen height, looping until the user exits. */
export default function MarqueeDisplay({ message, settings, onExit }: Props) {
  useEffect(() => {
    let release = () => {};
    let cancelled = false;
    void keepScreenAwake().then((fn) => {
      if (cancelled) fn();
      else release = fn;
    });
    return () => {
      cancelled = true;
      release();
    };
  }, []);

  // Entered from the Go click (a user gesture); left again whenever the marquee closes.
  useEffect(() => exitFullscreen, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  return (
    <MarqueeTrack
      message={message}
      settings={settings}
      className={styles.stage}
      testId="marquee"
    >
      <button type="button" className={styles.exit} onClick={onExit}>
        ✕ Exit
      </button>
    </MarqueeTrack>
  );
}
