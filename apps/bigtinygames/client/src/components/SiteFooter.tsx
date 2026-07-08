import { trackEvent } from "../lib/analytics";
import styles from "./SiteFooter.module.css";

const SITE_URL = "https://www.ericjorgensen.com";

/**
 * The standard arcade footer, shared across the lobby and the game pages: an
 * "INSERT COIN" flourish and a copyright notice attributed to Eric Jorgensen
 * that links to his main site.
 */
export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <p>
        INSERT COIN ·{" "}
        <a
          className={styles.link}
          href={SITE_URL}
          onClick={() => trackEvent("outbound_link", { url: SITE_URL, name: "footer-copyright" })}
        >
          © {new Date().getFullYear()} Eric Jorgensen
        </a>
      </p>
    </footer>
  );
}
