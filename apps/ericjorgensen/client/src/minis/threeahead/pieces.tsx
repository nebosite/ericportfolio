import { ReactElement } from "react";
import { PieceType, Side } from "./engine/chess";

// Art deco chess piece glyphs — flat geometric silhouettes with gold linework,
// drawn in a 100×100 viewBox. Every piece stands on the same stepped ziggurat
// plinth; crowns and heads are fans, lancets and chevrons in the deco manner.

interface Palette {
  body: string;
  line: string;
  accent: string;
}

const WHITE_PALETTE: Palette = { body: "#f3e7c6", line: "#7a5c1e", accent: "#a8802e" };
const BLACK_PALETTE: Palette = { body: "#20222c", line: "#d9b45b", accent: "#d9b45b" };

/** The shared stepped plinth every piece stands on. */
function Plinth({ p }: { p: Palette }) {
  return (
    <>
      <rect x="30" y="77" width="40" height="7" fill={p.body} stroke={p.line} strokeWidth="3" />
      <rect x="24" y="84" width="52" height="8" fill={p.body} stroke={p.line} strokeWidth="3" />
    </>
  );
}

function Pawn({ p }: { p: Palette }) {
  return (
    <g>
      <Plinth p={p} />
      <path d="M43 51 L57 51 L63 77 L37 77 Z" fill={p.body} stroke={p.line} strokeWidth="3" />
      <path d="M41 62 L50 56 L59 62" fill="none" stroke={p.accent} strokeWidth="2.5" />
      <circle cx="50" cy="37" r="13" fill={p.body} stroke={p.line} strokeWidth="3" />
      <circle cx="50" cy="37" r="5" fill="none" stroke={p.accent} strokeWidth="2" />
    </g>
  );
}

function Rook({ p }: { p: Palette }) {
  return (
    <g>
      <Plinth p={p} />
      <path
        d="M34 77 L34 30 L42 30 L42 38 L46 38 L46 30 L54 30 L54 38 L58 38 L58 30 L66 30 L66 77 Z"
        fill={p.body}
        stroke={p.line}
        strokeWidth="3"
      />
      <line x1="44" y1="50" x2="44" y2="70" stroke={p.accent} strokeWidth="2" />
      <line x1="50" y1="50" x2="50" y2="70" stroke={p.accent} strokeWidth="2" />
      <line x1="56" y1="50" x2="56" y2="70" stroke={p.accent} strokeWidth="2" />
      <line x1="34" y1="46" x2="66" y2="46" stroke={p.line} strokeWidth="2.5" />
    </g>
  );
}

function Knight({ p }: { p: Palette }) {
  return (
    <g>
      <Plinth p={p} />
      <path
        d="M38 77 L38 60 Q38 46 46 38 L42 20 L54 30 L68 38 L68 46 L56 48 L60 60 L62 77 Z"
        fill={p.body}
        stroke={p.line}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="55" cy="38" r="2.6" fill={p.line} />
      <path d="M44 44 L52 52 M42 52 L49 59 M41 60 L47 66" stroke={p.accent} strokeWidth="2.2" />
    </g>
  );
}

function Bishop({ p }: { p: Palette }) {
  return (
    <g>
      <Plinth p={p} />
      <path
        d="M50 18 C61 30 65 42 65 53 L60 77 L40 77 L35 53 C35 42 39 30 50 18 Z"
        fill={p.body}
        stroke={p.line}
        strokeWidth="3"
      />
      <line x1="50" y1="30" x2="58" y2="48" stroke={p.accent} strokeWidth="2.5" />
      <circle cx="50" cy="13" r="4.5" fill={p.body} stroke={p.line} strokeWidth="2.5" />
      <path d="M40 62 L50 56 L60 62" fill="none" stroke={p.accent} strokeWidth="2" />
    </g>
  );
}

function Queen({ p }: { p: Palette }) {
  return (
    <g>
      <Plinth p={p} />
      <path d="M39 45 L61 45 L66 77 L34 77 Z" fill={p.body} stroke={p.line} strokeWidth="3" />
      <path
        d="M31 45 L36 21 L44 38 L50 14 L56 38 L64 21 L69 45 Z"
        fill={p.body}
        stroke={p.line}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="36" cy="17" r="2.8" fill={p.accent} />
      <circle cx="50" cy="10" r="2.8" fill={p.accent} />
      <circle cx="64" cy="17" r="2.8" fill={p.accent} />
      <path
        d="M40 58 L50 52 L60 58 M42 68 L50 62 L58 68"
        fill="none"
        stroke={p.accent}
        strokeWidth="2"
      />
    </g>
  );
}

function King({ p }: { p: Palette }) {
  return (
    <g>
      <Plinth p={p} />
      <path d="M39 46 L61 46 L66 77 L34 77 Z" fill={p.body} stroke={p.line} strokeWidth="3" />
      {/* Sunburst crown */}
      <path
        d="M34 46 L38 30 L44 40 L50 26 L56 40 L62 30 L66 46 Z"
        fill={p.body}
        stroke={p.line}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Cross finial */}
      <path
        d="M47.5 6 L52.5 6 L52.5 12 L58 12 L58 17 L52.5 17 L52.5 24 L47.5 24 L47.5 17 L42 17 L42 12 L47.5 12 Z"
        fill={p.body}
        stroke={p.line}
        strokeWidth="2.5"
      />
      <path
        d="M40 58 L50 52 L60 58 M42 68 L50 62 L58 68"
        fill="none"
        stroke={p.accent}
        strokeWidth="2"
      />
    </g>
  );
}

const GLYPHS: Record<PieceType, (props: { p: Palette }) => ReactElement> = {
  pawn: Pawn,
  rook: Rook,
  knight: Knight,
  bishop: Bishop,
  queen: Queen,
  king: King,
};

export default function PieceGlyph({ type, side }: { type: PieceType; side: Side }) {
  const Glyph = GLYPHS[type];
  const palette = side === "white" ? WHITE_PALETTE : BLACK_PALETTE;
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false">
      <Glyph p={palette} />
    </svg>
  );
}
