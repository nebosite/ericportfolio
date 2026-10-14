import MarqueeTrack from "./MarqueeTrack";
import { Settings } from "./settings";
import styles from "./HandsHighPage.module.css";

interface Props {
  orientation: "portrait" | "landscape";
  message: string;
  settings: Settings;
}

/** A small mock-up of a phone held in a hand, its screen running the real marquee. */
export default function PhoneInHand({ orientation, message, settings }: Props) {
  return (
    <div className={`${styles.hand} ${styles[orientation]}`}>
      <div className={styles.palm} />
      <div className={styles.phone}>
        <MarqueeTrack
          message={message}
          settings={settings}
          className={styles.phoneScreen}
          testId={`preview-${orientation}`}
        />
      </div>
      <div className={styles.thumb} />
      <div className={styles.fingers}>
        <i />
        <i />
        <i />
        {orientation === "landscape" && <i />}
      </div>
    </div>
  );
}
