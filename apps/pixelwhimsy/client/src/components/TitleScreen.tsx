import FeedbackPanel from "./FeedbackPanel";
import { trackEvent } from "../lib/analytics";
import styles from "./TitleScreen.module.css";

const SITE_URL = "https://www.ericjorgensen.com";

// The title screen: the only place with grown-up controls. Start drops the child
// into the full-screen sandbox; the feedback buttons and parent notes live here.
// The footer lives here too — a grown-up affordance that vanishes the moment
// drawing starts (this whole screen unmounts), so no link is ever reachable from
// inside the child sandbox.

export default function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className={styles.title}>
      <img className={styles.logo} src="/pixelwhimsy-logo.png" alt="PixelWhimsy" />
      <p className={styles.tagline}>Paint tiny pictures. Make big smiles!</p>

      <button type="button" className={styles.start} onClick={onStart}>
        ▶ Start Painting
      </button>

      <div className={styles.feedback}>
        <FeedbackPanel entity="pixelwhimsy" />
      </div>

      <section className={styles.parents}>
        <h2 className={styles.parentsTitle}>For grown-ups</h2>
        <ul className={styles.parentsList}>
          <li>
            Tap <strong>Start Painting</strong> and the app fills the whole screen, so little hands
            can't wander off into the rest of the device.
          </li>
          <li>
            There's no way to leave by accident: the small <strong>exit button</strong> (top-left
            corner) asks a multiplication question first — a wrong answer locks it for ten seconds.
          </li>
          <li>
            Pick a color along the top, a brush down the left, and let them tap, drag, and bang
            away. It's a sandbox — there's nothing to break and nothing to save.
          </li>
        </ul>
      </section>

      <footer className={styles.footer}>
        <a
          className={styles.footerLink}
          href={SITE_URL}
          onClick={() => trackEvent("outbound_link", { url: SITE_URL, name: "portfolio" })}
        >
          ↩ Back to Eric Jorgensen&rsquo;s portfolio
        </a>
        <a
          className={styles.footerLink}
          href={SITE_URL}
          onClick={() => trackEvent("outbound_link", { url: SITE_URL, name: "footer-copyright" })}
        >
          © {new Date().getFullYear()} Eric Jorgensen
        </a>
      </footer>
    </div>
  );
}
