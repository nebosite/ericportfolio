import { Link } from "react-router-dom";
import BigAsterTinyOids from "./BigAsterTinyOids";
import SiteFooter from "../../components/SiteFooter";
import { useEngagement } from "../../lib/engagement";
import styles from "./BigAsterTinyOidsPage.module.css";

export default function BigAsterTinyOidsPage() {
  useEngagement("big-aster-tiny-oids");
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>★ BIG ASTER TINY OIDS ★</h1>
        <span className={styles.spacer} aria-hidden="true" />
      </header>

      <main className={styles.main}>
        <BigAsterTinyOids />
      </main>

      <SiteFooter />
    </div>
  );
}
