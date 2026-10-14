import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fontSizeForHeight, fontStyle, marqueeOffset, scrollSpeed } from "./marquee";
import { Settings } from "./settings";
import styles from "./HandsHighPage.module.css";

interface Props {
  message: string;
  settings: Settings;
  /** Extra class for the sizing box (fullscreen stage or small preview). */
  className: string;
  children?: ReactNode;
  testId?: string;
}

/**
 * The scrolling text itself. It fills whatever box it is given: letters are sized to that
 * box's height, so the same component drives the fullscreen display and the small preview.
 */
export default function MarqueeTrack({ message, settings, className, children, testId }: Props) {
  const { charsPerSecond, fg, bg, bold, font } = settings;
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track the box's own size, so rotating the phone re-fits the letters.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Animate by writing transform directly — no React re-render per frame. The text is
  // re-measured whenever the typeface changes, since that changes its width.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const textWidth = el.offsetWidth;
    const speed = scrollSpeed(textWidth, message.length, charsPerSecond);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const x = marqueeOffset(now - start, size.w, textWidth, speed);
      el.style.transform = `translate3d(${x}px, -50%, 0)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [message, charsPerSecond, bold, font, size]);

  const textStyle: CSSProperties = {
    fontSize: fontSizeForHeight(size.h),
    color: fg,
    ...fontStyle(bold, font),
  };
  return (
    <div
      ref={boxRef}
      className={`${styles.track} ${className}`}
      style={{ background: bg }}
      data-testid={testId}
    >
      {children}
      <div ref={textRef} className={styles.text} style={textStyle}>
        {message}
      </div>
    </div>
  );
}
