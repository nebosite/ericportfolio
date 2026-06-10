import PixelCanvas from '../components/PixelCanvas';
import styles from './HomePage.module.css';

export default function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        {/* PLACEHOLDER ART: bouncy hand-drawn PixelWhimsy logo with crayon
            texture goes here (~480x140px). The wordmark below is a stand-in. */}
        <h1 className={styles.logo}>
          <span className={styles.logoPixel}>Pixel</span>
          <span className={styles.logoWhimsy}>Whimsy</span>
        </h1>
        <p className={styles.tagline}>Paint tiny pictures. Make big smiles!</p>
      </header>

      <main className={styles.main}>
        <PixelCanvas />
      </main>

      <footer className={styles.footer}>
        {/* PLACEHOLDER ART: a parade of tiny pixel critters marching across
            the footer in the owner's quirky style. */}
        <p>Made with 🖍️ for curious kids everywhere</p>
      </footer>
    </div>
  );
}
