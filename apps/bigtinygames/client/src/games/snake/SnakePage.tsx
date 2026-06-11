import { Link } from 'react-router-dom';
import SnakeGame from './SnakeGame';
import styles from './SnakePage.module.css';

export default function SnakePage() {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>★ BIG TINY SNAKE ★</h1>
        <span className={styles.spacer} aria-hidden="true" />
      </header>

      <main className={styles.main}>
        <SnakeGame />
      </main>

      <footer className={styles.footer}>
        <p>INSERT COIN · © {new Date().getFullYear()} BIG TINY GAMES</p>
      </footer>
    </div>
  );
}
