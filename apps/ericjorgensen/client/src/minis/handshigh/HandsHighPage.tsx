import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SiteFooter from "../../components/SiteFooter";
import { trackEvent } from "../../lib/analytics";
import ColorSwatches from "./ColorSwatches";
import MarqueeDisplay from "./MarqueeDisplay";
import PhoneInHand from "./PhoneInHand";
import {
  MAX_CHARS_PER_SECOND,
  MAX_MESSAGE_LENGTH,
  MIN_CHARS_PER_SECOND,
  fontStyle,
  normalizeMessage,
} from "./marquee";
import { attachManifest, enterFullscreen, registerServiceWorker } from "./pwa";
import { loadSettings, saveSettings } from "./settings";
import styles from "./HandsHighPage.module.css";

const STORAGE_KEY = "handshigh:message";
const DEMO_MESSAGE = "HANDS HIGH";
const PLACEHOLDER = 'Enter a message.  e.g.: "Meet me at the fountain"';

function loadMessage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveMessage(message: string) {
  try {
    localStorage.setItem(STORAGE_KEY, message);
  } catch {
    /* storage unavailable — the message just won't be remembered */
  }
}

/** Hands High: turn your phone into a giant scrolling sign to signal across a crowd. */
export default function HandsHighPage() {
  const [draft, setDraft] = useState(loadMessage);
  const [settings, setSettings] = useState(loadSettings);
  const [active, setActive] = useState<string | null>(null);
  const exit = useCallback(() => setActive(null), []);

  useEffect(() => {
    registerServiceWorker();
    return attachManifest();
  }, []);

  useEffect(() => saveSettings(settings), [settings]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const message = normalizeMessage(draft);
    if (!message) return;
    saveMessage(draft.trim());
    enterFullscreen();
    trackEvent("marquee_start", { game: "hands-high", length: message.length });
    setActive(message);
  };

  if (active) return <MarqueeDisplay message={active} settings={settings} onExit={exit} />;

  const previewProps = { message: normalizeMessage(draft) || DEMO_MESSAGE, settings };
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <Link to="/" className={styles.back}>
          ← ericjorgensen.com
        </Link>
        <h1 className={styles.title}>Hands High</h1>
        <p className={styles.blurb}>
          Type a message, press Go, and your phone becomes a giant scrolling sign to hold up across
          a crowd. Turn it either way:
        </p>
        <div className={styles.mockups} aria-label="Preview">
          <PhoneInHand orientation="portrait" {...previewProps} />
          <PhoneInHand orientation="landscape" {...previewProps} />
        </div>
      </section>

      <form onSubmit={go} className={styles.form}>
        <label htmlFor="hh-message" className={styles.label}>
          Your message
        </label>
        <textarea
          id="hh-message"
          className={styles.input}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          placeholder={PLACEHOLDER}
          style={fontStyle(settings.bold, settings.font)}
          onChange={(e) => setDraft(e.target.value)}
        />

        <label className={styles.control}>
          <span className={styles.label}>Speed</span>
          <input
            type="range"
            aria-label="Speed"
            min={MIN_CHARS_PER_SECOND}
            max={MAX_CHARS_PER_SECOND}
            step={0.1}
            value={settings.charsPerSecond}
            onChange={(e) => setSettings({ ...settings, charsPerSecond: Number(e.target.value) })}
          />
        </label>

        <div className={styles.options}>
          <button
            type="button"
            aria-pressed={settings.bold}
            className={styles.toggle}
            onClick={() => setSettings({ ...settings, bold: !settings.bold })}
          >
            Bold: {settings.bold ? "On" : "Off"}
          </button>
          <div role="radiogroup" aria-label="Font" className={styles.segmented}>
            {(["wide", "narrow"] as const).map((font) => (
              <button
                key={font}
                type="button"
                role="radio"
                aria-checked={settings.font === font}
                className={styles.segment}
                onClick={() => setSettings({ ...settings, font })}
              >
                {font === "wide" ? "Wide" : "Narrow"}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.colors}>
          <ColorSwatches
            label="Text color"
            value={settings.fg}
            onChange={(fg) => setSettings({ ...settings, fg })}
          />
          <ColorSwatches
            label="Background color"
            value={settings.bg}
            onChange={(bg) => setSettings({ ...settings, bg })}
          />
        </div>

        <button type="submit" className={styles.go} disabled={!normalizeMessage(draft)}>
          Go
        </button>
      </form>

      <div className={styles.footer}>
        <SiteFooter>Add to your home screen to use it offline.</SiteFooter>
      </div>
    </main>
  );
}
