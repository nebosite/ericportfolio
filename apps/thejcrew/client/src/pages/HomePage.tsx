import styles from './HomePage.module.css';

export default function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        {/* PLACEHOLDER ART: hand-drawn family portrait in the owner's quirky
            style goes here (~600x220px) — the whole crew waving hello. */}
        <div className={styles.portraitPlaceholder} aria-hidden="true">
          👋 the whole crew waves hello 👋
        </div>
        <h1 className={styles.title}>The J Crew</h1>
        <p className={styles.welcome}>
          Welcome to our little corner of the internet! Pull up a chair, grab a cookie, and stay a
          while.
        </p>
      </header>

      <main className={styles.main}>
        {/* PLACEHOLDER: the family's content (photos, news, recipes…) goes here. */}
        <p className={styles.comingSoon}>More from the crew coming soon. 🍪</p>
      </main>

      <footer className={styles.footer}>
        <p>The J Crew · est. way back when · made with love (and leftovers)</p>
      </footer>
    </div>
  );
}
