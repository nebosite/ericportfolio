import { growMark, GrowthStyle } from "../lib/growMark";

// Renders a grown "specimen" mark as inline SVG. Decorative — strokes are ink,
// buds are filled with the category accent (garnish on) or ink (garnish off).

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
  const mark = growMark(seed, style, strokeScale, growthSeed);
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
      {mark.segments.map((s, i) => (
        <line
          key={`l${i}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={INK}
          strokeWidth={s.w}
          strokeLinecap={mark.cap}
        />
      ))}
      {mark.buds.map((b, i) =>
        mark.square ? (
          <rect
            key={`b${i}`}
            x={b.x - sq / 2}
            y={b.y - sq / 2}
            width={sq}
            height={sq}
            fill={budFill}
          />
        ) : (
          <circle key={`b${i}`} cx={b.x} cy={b.y} r={budR} fill={budFill} />
        ),
      )}
    </svg>
  );
}
