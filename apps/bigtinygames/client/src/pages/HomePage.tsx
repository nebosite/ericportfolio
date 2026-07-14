import { Link } from "react-router-dom";
import { GAMES } from "../games/registry";
import SiteFooter from "../components/SiteFooter";
import styles from "./HomePage.module.css";

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

      <main className={styles.lobby}>
        <h2 className={styles.lobbyTitle}>★ SELECT YOUR GAME ★</h2>
        <div className={styles.cabinetRow}>
          {GAMES.map((game) => (
            <Link key={game.id} to={game.path} className={styles.cabinet}>
              <span className={styles.marquee}>{game.title}</span>
              {game.screenshot && (
                <span className={styles.preview}>
                  <img src={game.screenshot} alt={`${game.title} in action`} className={styles.previewImg} />
                </span>
              )}
              <span className={styles.blurb}>{game.blurb}</span>
              <span className={styles.cabinetFooter}>
                <span className={game.status === "ready" ? styles.badgeReady : styles.badgeWip}>
                  {game.status === "ready" ? "READY TO PLAY" : "UNDER CONSTRUCTION"}
                </span>
                <span className={styles.play}>▶ PLAY</span>
              </span>
            </Link>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
