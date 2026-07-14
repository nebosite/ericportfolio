import { Link } from "react-router-dom";
import BigSpaceTinyInvaders from "./BigSpaceTinyInvaders";
import SiteFooter from "../../components/SiteFooter";
import { useEngagement } from "../../lib/engagement";
import styles from "./BigSpaceTinyInvadersPage.module.css";

export default function BigSpaceTinyInvadersPage() {
  useEngagement("big-space-tiny-invaders");
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>★ BIG SPACE TINY INVADERS ★</h1>
        <span className={styles.spacer} aria-hidden="true" />
      </header>

      <main className={styles.main}>
        <BigSpaceTinyInvaders />
      </main>

      <SiteFooter />
    </div>
  );
}
