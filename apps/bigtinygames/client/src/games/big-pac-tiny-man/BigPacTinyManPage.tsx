import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BigPacEngine, WorldStats } from './engine';
import styles from './BigPacTinyMan.module.css';

export default function BigPacTinyManPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [worldKey, setWorldKey] = useState(0);

  // The maze, ghost count, etc. all derive from the page size, so a resize
  // means a new world. Debounced so drag-resizing doesn't thrash the GPU.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWorldKey((k) => k + 1), 400);
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
    BigPacEngine.create(host, setStats).then((e) => {
      if (disposed) e.destroy();
      else engine = e;
    });
    return () => {
      disposed = true;
      engine?.destroy();
    };
  }, [worldKey]);

  return (
    <div className={styles.page}>
      <div ref={hostRef} key={worldKey} className={styles.stage} />

      <div className={styles.hud}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>BIG PAC TINY MAN</h1>
        <p className={styles.notice}>
          STUB BUILD — wander the labyrinth and eat dots; ghost AI, lives &amp; scoring coming
          soon.
        </p>
        {stats && (
          <ul className={styles.stats}>
            <li>
              MAZE: {stats.cols}×{stats.rows} TILES
            </li>
            <li>
              DOTS: {stats.dotsEaten}/{stats.dotsTotal}
            </li>
            <li>GHOSTS: {stats.ghosts}</li>
            <li>POWER PELLETS: {stats.powerPellets}</li>
            <li>GHOST BASES: {stats.ghostBases}</li>
          </ul>
        )}
        <p className={styles.controls}>ARROWS / WASD / D-PAD / LEFT STICK</p>
      </div>
    </div>
  );
}
