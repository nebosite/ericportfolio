import { useEffect, useRef, useState } from 'react';
import styles from './PortraitStrip.module.css';

// All square portraits — Vite bundles them as hashed asset URLs at build time.
const photoModules = import.meta.glob<string>(
  '../../assetts/Photos/squares/*.jpg',
  { eager: true, query: '?url', import: 'default' },
);
const ALL_PHOTOS: string[] = Object.values(photoModules);

function pickRandom(exclude: ReadonlySet<string>): string | null {
  const pool = ALL_PHOTOS.filter((p) => !exclude.has(p));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickInitial(count: number): string[] {
  const result: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const pick = pickRandom(used);
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

  const [slots, setSlots] = useState<string[]>(() => pickInitial(count));

  // Track mobile breakpoint
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= MOBILE_BP);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reinitialize slots when crossing the mobile breakpoint
  useEffect(() => {
    if (prevCount.current === count) return;
    prevCount.current = count;
    setSlots(pickInitial(count));
  }, [count]);

  // Replace one random slot every 10–15 seconds; never show a photo twice.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const rotate = () => {
      setSlots((prev) => {
        const used = new Set(prev);
        const idx = Math.floor(Math.random() * prev.length);
        used.delete(prev[idx]); // the evicted slot is no longer "used"
        const next = pickRandom(used);
        if (!next) return prev;
        const updated = [...prev];
        updated[idx] = next;
        return updated;
      });
      timer = setTimeout(rotate, 10_000 + Math.random() * 5_000);
    };

    timer = setTimeout(rotate, 10_000 + Math.random() * 5_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.strip}>
      {slots.map((url, i) => (
        <img
          key={url}
          src={url}
          alt={`Portrait ${i + 1}`}
          className={styles.portrait}
          width={150}
          height={150}
        />
      ))}
    </div>
  );
}
