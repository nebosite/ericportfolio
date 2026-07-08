import { ReactNode } from "react";
import { trackEvent } from "../lib/analytics";
import styles from "./SiteFooter.module.css";

const SITE_URL = "https://www.ericjorgensen.com";

/**
 * The standard site footer: a copyright notice attributed to Eric Jorgensen
 * that links to his main site. Theme-neutral (muted gray, transparent
 * background) so it reads on both the light portfolio pages and the dark
 * Pitchcraft page. Optional `children` render before the copyright for a
 * page-specific tagline.
 */
export default function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className={styles.footer}>
      {children && <span className={styles.note}>{children}</span>}
      <a
        className={styles.copyright}
        href={SITE_URL}
        onClick={() => trackEvent("outbound_link", { url: SITE_URL, name: "footer-copyright" })}
      >
        © {new Date().getFullYear()} Eric Jorgensen
      </a>
    </footer>
  );
}
