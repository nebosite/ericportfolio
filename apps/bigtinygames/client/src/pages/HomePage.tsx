import SnakeGame from '../components/SnakeGame';
import styles from './HomePage.module.css';

export default function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        {/* PLACEHOLDER ART: chunky retro "BIG TINY GAMES" logo with the
            owner's hand-pixeled lettering goes here (~640x120px). */}
        <h1 className={styles.logo}>
          BIG <span className={styles.logoTiny}>tiny</span> GAMES
        </h1>
        <p className={styles.tagline}>
          Classic games reimagined: a LARGE canvas, original tiny pixel sprites.
        </p>
      </header>

      <main className={styles.main}>
        <h2 className={styles.cabinetTitle}>★ BIG TINY SNAKE ★</h2>
        <SnakeGame />
      </main>

      <footer className={styles.footer}>
        <p>INSERT COIN · © {new Date().getFullYear()} BIG TINY GAMES</p>
      </footer>
    </div>
  );
}
