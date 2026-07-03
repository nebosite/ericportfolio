import { Link } from "react-router-dom";
import BigPipeTinyDream from "./BigPipeTinyDream";
import styles from "./BigPipeTinyDreamPage.module.css";

export default function BigPipeTinyDreamPage() {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>★ BIG PIPE TINY DREAM ★</h1>
        <span className={styles.spacer} aria-hidden="true" />
      </header>

      <main className={styles.main}>
        <BigPipeTinyDream />
      </main>

      <footer className={styles.footer}>
        <p>INSERT COIN · © {new Date().getFullYear()} BIG TINY GAMES</p>
      </footer>
    </div>
  );
}
