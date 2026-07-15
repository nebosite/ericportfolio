import { Link } from "react-router-dom";
import BigRoboTinyTron from "./BigRoboTinyTron";
import SiteFooter from "../../components/SiteFooter";
import { useEngagement } from "../../lib/engagement";
import styles from "./BigRoboTinyTronPage.module.css";

export default function BigRoboTinyTronPage() {
  useEngagement("big-robo-tiny-tron");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>★ BIG ROBO TINY TRON ★</h1>
        <span aria-hidden="true" style={{ width: "5rem" }} />
      </header>

      <main className={styles.main}>
        <BigRoboTinyTron />
      </main>

      <SiteFooter />
    </div>
  );
}
