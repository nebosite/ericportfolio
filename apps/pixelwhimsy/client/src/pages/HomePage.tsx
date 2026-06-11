import PixelCanvas from '../components/PixelCanvas';
import styles from './HomePage.module.css';

export default function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        {/* Logo lifted from the original pixelwhimsy.com masthead (the wordmark
            band, cropped above the old nav). Lives in client/public/. */}
        <h1 className={styles.logo}>
          <img className={styles.logoImg} src="/pixelwhimsy-logo.png" alt="PixelWhimsy" />
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
