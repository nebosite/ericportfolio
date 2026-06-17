import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./GalleryPage.module.css";

interface GalleryItem {
  title: string;
  file: string;
  description: string;
}

interface GalleryPageProps {
  /** Media subfolder name, e.g. "Art" (matches /api/media/<folder>). */
  folder: string;
  /** Display heading for the page. */
  heading: string;
}

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
}

export function writeCookie(name: string, value: string, days = 365): void {
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function GalleryPage({ folder, heading }: GalleryPageProps) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setSelected(0);
    setFailed(false);
    fetch(`/api/media/${folder}/contents.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: GalleryItem[]) => {
        if (cancelled) return;
        // On the first visit of a new calendar day, shuffle the order. A cookie
        // per gallery remembers the last day we shuffled.
        const today = new Date().toDateString();
        const cookie = `ejgallery_day_${folder}`;
        const isNewDay = readCookie(cookie) !== today;
        if (isNewDay) writeCookie(cookie, today);
        setItems(isNewDay ? shuffle(data) : data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  const count = items.length;

  // Move by delta with wrap-around at either end.
  const step = useCallback(
    (delta: number) => {
      setSelected((s) => (count === 0 ? 0 : (s + delta + count) % count));
    },
    [count],
  );

  // Arrow keys: up/left = previous, down/right = next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Auto-advance to the next photo after 60s. The timer resets whenever the
  // selection changes, so a manual move restarts the countdown.
  useEffect(() => {
    if (count === 0) return;
    const timer = setTimeout(() => step(1), 60_000);
    return () => clearTimeout(timer);
  }, [selected, count, step]);

  const current = items[selected];

  // Open the full-resolution image in a child popup window sized to the image.
  const openFullRes = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = Math.min(img.naturalWidth || 1000, window.screen.availWidth - 80);
    const h = Math.min(
      img.naturalHeight || 800,
      window.screen.availHeight - 120,
    );
    window.open(img.src, "_blank", `popup=1,width=${w},height=${h}`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Link to="/" className={styles.back}>
          ← Home
        </Link>
        <h1 className={styles.heading}>{heading}</h1>
      </header>

      <div className={styles.body}>
        <nav className={styles.titleList} aria-label={`${heading} list`}>
          {items.map((item, i) => (
            <button
              key={item.file}
              type="button"
              className={i === selected ? styles.titleActive : styles.title}
              onClick={() => setSelected(i)}
            >
              {item.title}
            </button>
          ))}
        </nav>

        <main className={styles.viewer}>
          {current && (
            <figure className={styles.figure}>
              <img
                className={styles.image}
                src={`/api/media/${folder}/${encodeURIComponent(current.file)}`}
                alt={current.title}
                onClick={openFullRes}
                title="Click to open full resolution"
              />
              <figcaption className={styles.caption}>
                <h2 className={styles.captionTitle}>{current.title}</h2>
                <p className={styles.captionDesc}>{current.description}</p>
              </figcaption>
            </figure>
          )}
          {failed && (
            <p className={styles.empty}>Could not load this gallery.</p>
          )}
          {!failed && items.length === 0 && (
            <p className={styles.empty}>Loading…</p>
          )}
        </main>
      </div>
    </div>
  );
}
