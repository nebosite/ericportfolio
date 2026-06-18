import { useMemo, type CSSProperties } from "react";
import { growMark, GrowthStyle } from "../lib/growMark";
import styles from "./GrownMark.module.css";

// Renders a grown "specimen" mark as inline SVG. Decorative — strokes are ink,
// buds are filled with the category accent (garnish on) or ink (garnish off).
// On mount the tree "grows in": branches draw from the base toward the tips and
// the buds pop at the end, over a short random time (per tree). The marks start
// hidden (see GrownMark.module.css) so there's no flash before they grow.

const INK = "#1d1b16";

export default function GrownMark({
  seed,
  style,
  accent,
  garnish = true,
  strokeScale = 1,
  growthSeed = 1,
}: {
  seed: string;
  style: GrowthStyle;
  accent: string;
  garnish?: boolean;
  strokeScale?: number;
  growthSeed?: number;
}) {
  const mark = useMemo(
    () => growMark(seed, style, strokeScale, growthSeed),
    [seed, style, strokeScale, growthSeed],
  );
  // Each tree picks its own short grow-in time; one "generation" per time slot.
  const duration = useMemo(() => 1.2 + Math.random() * 0.8, []);
  const slot = duration / (mark.maxGen + 1);

  const budFill = garnish ? accent : INK;
  const budR = 2.4 * strokeScale + 0.6;
  const sq = 4 * strokeScale + 1.2;

  return (
    <svg
      viewBox="0 0 120 150"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMax meet"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      {mark.segments.map((s, i) => {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const lineStyle = {
          strokeDasharray: len,
          "--gm-len": len,
          "--gm-delay": `${s.gen * slot}s`,
          "--gm-dur": `${slot * 1.4}s`,
        } as CSSProperties;
        return (
          <line
            key={`l${i}`}
            className={styles.line}
            style={lineStyle}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={INK}
            strokeWidth={s.w}
            strokeLinecap={mark.cap}
          />
        );
      })}
      {mark.buds.map((b, i) => {
        const budStyle = {
          "--gm-delay": `${b.gen * slot}s`,
          "--gm-dur": `${slot}s`,
        } as CSSProperties;
        return mark.square ? (
          <rect
            key={`b${i}`}
            className={styles.bud}
            style={budStyle}
            x={b.x - sq / 2}
            y={b.y - sq / 2}
            width={sq}
            height={sq}
            fill={budFill}
          />
        ) : (
          <circle
            key={`b${i}`}
            className={styles.bud}
            style={budStyle}
            cx={b.x}
            cy={b.y}
            r={budR}
            fill={budFill}
          />
        );
      })}
    </svg>
  );
}
