import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BigPacEngine } from './engine';
import FeedbackPanel from '../../components/FeedbackPanel';
import styles from './BigPacTinyMan.module.css';

export default function BigPacTinyManPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BigPacEngine | null>(null);
  const [score, setScore] = useState(0);
  const [worldKey, setWorldKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);

  // The maze derives from the page size, so a resize means a new world — but
  // only until play begins. Once the player has started, the world is locked
  // in and resizing just letterboxes the existing canvas.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (engineRef.current?.hasStarted) return;
        setStarted(false);
        setReady(false);
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
    setReady(false);
    BigPacEngine.create(host, setScore).then((e) => {
      if (disposed) {
        e.destroy();
      } else {
        engine = e;
        engineRef.current = e;
        setReady(true);
      }
    });
    return () => {
      disposed = true;
      engineRef.current = null;
      engine?.destroy();
    };
  }, [worldKey]);

  const handleStart = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.start();
    setStarted(true);
  };

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
      <div className={styles.stageWrap}>
        <div ref={hostRef} key={worldKey} className={styles.stage} />
        {!started && (
          <div className={styles.titleScreen}>
            <h2 className={styles.titleHeading}>BIG PAC TINY MAN</h2>
            <button
              type="button"
              className={styles.startButton}
              onClick={handleStart}
              disabled={!ready}
            >
              {ready ? '▶ START GAME' : 'LOADING…'}
            </button>
            <p className={styles.titleHint}>Then steer with the arrow keys or WASD</p>
            <FeedbackPanel entity="big-pac-tiny-man" />
          </div>
        )}
      </div>
    </div>
  );
}
