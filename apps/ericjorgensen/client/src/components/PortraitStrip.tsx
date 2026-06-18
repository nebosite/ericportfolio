import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./PortraitStrip.module.css";

// Hand-pinned vertical offset + rotation per slot index (frontispiece feel).
const OFFSETS = [
  { ty: "0px", rot: "-1.1deg" },
  { ty: "2.8px", rot: "0.9deg" },
  { ty: "-1.4px", rot: "-0.7deg" },
  { ty: "1.8px", rot: "1.3deg" },
  { ty: "-0.6px", rot: "-0.9deg" },
];

// The portrait pool is served by the API (src/media/Photos/squares) instead of
// being bundled, so the browser only downloads the handful of images on screen.

export function pickRandom(
  pool: readonly string[],
  exclude: ReadonlySet<string>,
): string | null {
  const choices = pool.filter((p) => !exclude.has(p));
  if (choices.length === 0) return null;
  return choices[Math.floor(Math.random() * choices.length)];
}

export function pickInitial(pool: readonly string[], count: number): string[] {
  const result: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const pick = pickRandom(pool, used);
    if (!pick) break;
    result.push(pick);
    used.add(pick);
  }
  return result;
}

const MOBILE_BP = 640;

export default function PortraitStrip() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= MOBILE_BP);
  const count = mobile ? 3 : 5;
  const prevCount = useRef(count);

  const [pool, setPool] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>([]);

  // Load the available portraits once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/portraits")
      .then((res) => res.json())
      .then((urls: string[]) => {
        if (cancelled) return;
        setPool(urls);
        setSlots(pickInitial(urls, count));
        prevCount.current = count;
      })
      .catch(() => {
        /* leave the strip empty if the list can't load */
      });
    return () => {
      cancelled = true;
    };
    // count is intentionally read once at load; breakpoint changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track mobile breakpoint
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= MOBILE_BP);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Reinitialize slots when crossing the mobile breakpoint
  useEffect(() => {
    if (prevCount.current === count) return;
    prevCount.current = count;
    if (pool.length > 0) setSlots(pickInitial(pool, count));
  }, [count, pool]);

  // Replace one random slot every 10–15 seconds; never show a photo twice.
  useEffect(() => {
    if (pool.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;

    const rotate = () => {
      setSlots((prev) => {
        const used = new Set(prev);
        const idx = Math.floor(Math.random() * prev.length);
        used.delete(prev[idx]); // the evicted slot is no longer "used"
        const next = pickRandom(pool, used);
        if (!next) return prev;
        const updated = [...prev];
        updated[idx] = next;
        return updated;
      });
      timer = setTimeout(rotate, 10_000 + Math.random() * 5_000);
    };

    timer = setTimeout(rotate, 10_000 + Math.random() * 5_000);
    return () => clearTimeout(timer);
  }, [pool]);

  return (
    <div className={styles.strip}>
      {slots.map((url, i) => {
        const o = OFFSETS[i % OFFSETS.length];
        return (
          <div
            key={i}
            className={styles.slot}
            style={{ "--ty": o.ty, "--rot": o.rot } as CSSProperties}
          >
            <img
              key={url}
              src={url}
              alt={`Portrait ${i + 1}`}
              className={styles.portrait}
              width={120}
              height={120}
            />
          </div>
        );
      })}
    </div>
  );
}
