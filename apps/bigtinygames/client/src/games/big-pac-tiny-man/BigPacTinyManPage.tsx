import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BigPacEngine } from './engine';
import styles from './BigPacTinyMan.module.css';

export default function BigPacTinyManPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BigPacEngine | null>(null);
  const [score, setScore] = useState(0);
  const [worldKey, setWorldKey] = useState(0);

  // The maze derives from the page size, so a resize means a new world — but
  // only until play begins. Once the player has started, the world is locked
  // in and resizing just letterboxes the existing canvas.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (engineRef.current?.hasStarted) return;
        setWorldKey((k) => k + 1);
      }, 400);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: BigPacEngine | null = null;
    let disposed = false;
    BigPacEngine.create(host, setScore).then((e) => {
      if (disposed) {
        e.destroy();
      } else {
        engine = e;
        engineRef.current = e;
      }
    });
    return () => {
      disposed = true;
      engineRef.current = null;
      engine?.destroy();
    };
  }, [worldKey]);

  return (
    <div className={styles.page}>
      {/* 50px bar above the game grid — everything HUD lives here. */}
      <div className={styles.topBar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>BIG PAC TINY MAN</h1>
        <p className={styles.score}>SCORE {score.toLocaleString()}</p>
      </div>
      <div ref={hostRef} key={worldKey} className={styles.stage} />
    </div>
  );
}
