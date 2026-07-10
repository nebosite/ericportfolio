import { Link } from "react-router-dom";
import BigAstTinyERoids from "./BigAstTinyERoids";
import SiteFooter from "../../components/SiteFooter";
import { useEngagement } from "../../lib/engagement";
import styles from "./BigAstTinyERoidsPage.module.css";

export default function BigAstTinyERoidsPage() {
  useEngagement("big-ast-tiny-eroids");
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>★ BIG AST TINY EROIDS ★</h1>
        <span className={styles.spacer} aria-hidden="true" />
      </header>

      <main className={styles.main}>
        <BigAstTinyERoids />
      </main>

      <SiteFooter />
    </div>
  );
}
