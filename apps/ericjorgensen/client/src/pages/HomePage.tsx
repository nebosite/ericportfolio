import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PortraitStrip from '../components/PortraitStrip';
import styles from './HomePage.module.css';

export default function HomePage() {
  const [visitCount, setVisitCount] = useState<number | null>(null);
  const visitRecorded = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode double-invoking effects in dev,
    // which would otherwise record two visits per page load.
    if (visitRecorded.current) return;
    visitRecorded.current = true;
    fetch('/api/visit', { method: 'POST' })
      .then((res) => res.json())
      .then((data: { count: number }) => setVisitCount(data.count))
      .catch(() => setVisitCount(null));
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <PortraitStrip />
        <h1 className={styles.name}>Eric Jorgensen</h1>
        <p className={styles.tagline}>
          Working with AI to build things that are useful, interesting, and occasionally 
          whimsical.  
        </p>
      </header>

      <main className={styles.main}>

        <section className={styles.section}>
          <h2>Projects</h2>
          <ul className={styles.projectList}>
            {/* PLACEHOLDER ART: each project card gets a small hand-drawn
                thumbnail in the owner's style (~80x80px, left of the text). */}
            <li className={styles.projectCard}>
              <h3>
                <a href="https://pixelwhimsy.com">PixelWhimsy</a>
              </h3>
              <p>A colorful pixel-art toy for children.</p>
            </li>
            <li className={styles.projectCard}>
              <h3>
                <a href="https://bigtinygames.com">Big Tiny Games</a>
              </h3>
              <p>Classic games reimagined: large canvas, original tiny pixel sprites.</p>
            </li>
            <li className={styles.projectCard}>
              <h3>
                <Link to="/art">Art</Link>
              </h3>
              <p>Drawings and paintings, from quick studies to finished pieces.</p>
            </li>
            <li className={styles.projectCard}>
              <h3>
                <Link to="/photography">Photography</Link>
              </h3>
              <p>A wandering eye: moments, places, and light worth keeping.</p>
            </li>
            <li className={styles.projectCard}>
              <h3>
                <Link to="/poetry">Poetry</Link>
              </h3>
              <p>Short written pieces — words arranged with intent.</p>
            </li>
          </ul>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Eric Jorgensen</p>
      </footer>

      {visitCount !== null && (
        <p className={styles.visitCount}>{visitCount.toLocaleString()}</p>
      )}
    </div>
  );
}
