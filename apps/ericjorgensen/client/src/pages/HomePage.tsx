import { useEffect, useRef, useState } from 'react';
import Guestbook from '../components/Guestbook';
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
          Software developer. I build things that are useful, fast, and occasionally a little
          whimsical.
        </p>
        {visitCount !== null && (
          <p className={styles.visitCount}>
            You are visitor <strong>#{visitCount.toLocaleString()}</strong>
          </p>
        )}
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <h2>About</h2>
          <p>
            Welcome to my corner of the internet. I spend my days writing software and my spare
            time turning odd ideas into working code — from pixel toys for kids to tiny
            reimaginings of classic games. Everything on this server, from the apps to the
            deployment scripts, lives in one monorepo I built by hand.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Projects</h2>
          <ul className={styles.projectList}>
            {/* PLACEHOLDER ART: each project card gets a small hand-drawn
                thumbnail in the owner's style (~80x80px, left of the text). */}
            <li className={styles.projectCard}>
              <h3>
                <a href="https://pixelwhimsy.com">PixelWhimsy</a>
              </h3>
              <p>A colorful pixel-art toy for children, reborn as a web app.</p>
            </li>
            <li className={styles.projectCard}>
              <h3>
                <a href="https://bigtinygames.com">Big Tiny Games</a>
              </h3>
              <p>Classic games reimagined: large canvas, original tiny pixel sprites.</p>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Leave a note</h2>
          <p className={styles.sectionIntro}>
            This guestbook is a live demo of the full stack: React → Express → SQLite and back.
          </p>
          <Guestbook />
        </section>
      </main>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Eric Jorgensen · Built with React, Express &amp; SQLite</p>
      </footer>
    </div>
  );
}
