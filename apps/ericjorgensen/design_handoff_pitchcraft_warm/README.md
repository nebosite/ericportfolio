# Handoff: Pitchcraft — warm, play-first reskin

## Target repo
- **Repo root (on disk):** `F:\Git\ericportfolio`
- **Pitchcraft folder (relative):** `apps\ericjorgensen\client\src\minis`
- **Files you will touch:**
  - `PitchcraftPage.tsx` — the page/shell (home, intros, HUD chrome, results, overlays)
  - `PitchcraftPage.module.css` — all styling
  - `engine.ts` — the piano-roll trainer canvas
  - `gardenEngine.ts` — the Voice Garden canvas
  - `loomEngine.ts` — the Chroma Loom canvas
  - `rangeEngine.ts` — the Range Explorer flower canvas
  - `src/game/pitchGraph.ts` — the accuracy pitch graph (`drawPitchGraph`)
- **Stack:** React + Vite + TypeScript, CSS Modules. Keep it. Do not introduce new deps.

## Overview
Reskin the Pitchcraft mini from its current dark, technical "studio" look into something **warmer, more organic, hospitable, and musical**, and reorganize the home screen to **lead with play** and gently guide newcomers. Voice-type selection becomes a friendly, tucked-away step; the four experiences (Range Explorer, The Trainer, Voice Garden, Chroma Loom) come forward as inviting cards with **live animated previews**; practice stats move off the main entry.

The game logic, scoring, pitch detection, timing, and persistence are **unchanged** — this is UI/skin + home-screen information architecture only. Do not touch the tuned algorithms in `src/game/*` or the engine game loops except for the specific canvas *color/background* values called out under "Canvas color remap."

## About the design files
`Pitchcraft Warm.dc.html` in this bundle is a **design reference** — an HTML/JS prototype showing the intended look, layout, copy, and behavior. It is **not** production code to paste in. Recreate it in the existing React + TypeScript + CSS-Modules environment using the codebase's established patterns (the current `PitchcraftPage.tsx` structure, `styles.*` classes, engine `setCanvas` ref pattern). The prototype stands in the four game canvases with lightweight decorative animations because it cannot run the real mic/engines; in the real app the previews are small instances of the **real** engines (see "Card live previews").

## Fidelity
**High-fidelity.** Final palette, typography, spacing, copy, and interactions are specified below with exact values. Recreate pixel-close using the codebase's patterns. The one deliberately-approximate part is the *card preview animations* — match their spirit (a real moving sliver of each game), implemented with the real engines rather than the prototype's decorative canvas.

---

## Design tokens

Introduce a **theme system** with three palettes. Default = **dawn**. Implement as CSS custom properties on a `[data-theme]` wrapper (set the attribute from a `theme` value; default `"dawn"`). Every color below replaces a hardcoded value currently in the CSS module / engines.

### Themes (CSS custom properties)

```css
:root, [data-theme="warm-dark"] {
  --bg: radial-gradient(1300px 720px at 50% -12%, #2c2116 0%, #191209 58%, #120d07 100%);
  --ink: #f3ead6; --ink-dim: #c3b28f; --ink-faint: #8f7d5f;
  --panel: linear-gradient(180deg, #241c12, #1b140c); --panel2: #1a1309;
  --card: #1d1610; --card-line: #3a2f1c; --line: #3a2f1c; --line-soft: #2a2115;
  --chip: rgba(242,177,60,0.10); --scrim: rgba(15,10,5,0.72);
  --amber: #f2b13c; --coral: #ec7d4e; --sage: #a9b565; --orchid: #d090d6;
}
[data-theme="warm-light"] {
  --bg: radial-gradient(1300px 720px at 50% -8%, #fdf5e6 0%, #f6ead3 62%, #efe0c6 100%);
  --ink: #33261a; --ink-dim: #7a6446; --ink-faint: #a08a68;
  --panel: linear-gradient(180deg, #fffdf6, #fbf2e0); --panel2: #fdf6e9;
  --card: #fffbf1; --card-line: #ecdcbf; --line: #e7d6b9; --line-soft: #f0e4cd;
  --chip: rgba(199,133,25,0.12); --scrim: rgba(250,242,228,0.78);
  --amber: #c8891f; --coral: #c8592c; --sage: #6f8a2f; --orchid: #a552ab;
}
[data-theme="dawn"] {                       /* DEFAULT */
  --bg: linear-gradient(178deg, #f6ddb6 0%, #f0c199 26%, #d99e86 50%, #9a7c7f 74%, #4f4658 100%);
  --ink: #34261f; --ink-dim: #6b5344; --ink-faint: #8f7566;
  --panel: linear-gradient(180deg, rgba(255,252,244,0.94), rgba(252,240,222,0.9)); --panel2: rgba(255,250,240,0.82);
  --card: rgba(255,251,242,0.9); --card-line: rgba(120,92,70,0.24); --line: rgba(120,92,70,0.22); --line-soft: rgba(120,92,70,0.14);
  --chip: rgba(180,110,40,0.14); --scrim: rgba(40,30,34,0.5);
  --amber: #c07e1c; --coral: #c1552b; --sage: #6e862f; --orchid: #9a4fa0;
}
```

### Per-game accent
- Range Explorer → `--coral`
- The Trainer → `--amber`
- Voice Garden → `--sage`
- Chroma Loom → `--orchid`

### Type (unchanged pairing, warmed usage)
- **Display / body:** `'Spectral', Georgia, serif` (weights 300/400/500; italic 300 for taglines).
- **Labels / numbers / note names:** `'Spline Sans Mono', monospace` — use **sparingly** now (kickers, stats, HUD numbers, hints). Everything that reads as prose or a heading should be Spectral. The old design's mono-everywhere is what read "technical."

### Radii / misc
- Cards & panels: `16px`. Inner preview windows: `11px`. Chips/pills: `20–22px`. Buttons: `9–10px`.
- Keep borders 1px. Avoid heavy shadows; lift on hover via `translateY(-3/-4px)` + accent border.
- Entrance: `@keyframes` fade / rise (`opacity 0→1`, `translateY(14px→0)`, ~0.4–0.5s ease).

### Current → token mapping (search-and-replace guide)
Existing hardcoded values in `PitchcraftPage.module.css` / inline styles / engines map to:
- `#0a0b0f`, `#0c0d12` page/stage bg → `var(--bg)` (page) / keep dark for canvas interiors (see remap)
- panel `#101218` / `#16181f` → `var(--panel)` / `var(--panel2)`
- border `#23262f`, `#2c2f3a` → `var(--line)` / `var(--card-line)`
- text `#c9cdd6`, `#f3efe6` → `var(--ink)`; dim `#8a90a0` → `var(--ink-dim)`; faint `#6b7180`/`#565c6a` → `var(--ink-faint)`
- accent `#F4B23E` → `var(--amber)` (UI chrome only — see note under Canvas color remap)
- teal `#35C4B5` (preview/vibrato) → keep as-is in engines (semantic), but for garden zone chrome you may use `var(--sage)`
- loom `#B653F7` → `var(--orchid)`

---

## Screens / views

State machine in `PitchcraftPage.tsx` is largely intact. Phases: `intro`(=home) · `playing`/`done` (trainer) · `range`/`rangeDone` · `garden`/`gardenDone` · `loom`. Add two **overlay** flags: `showVoice`, `showPractice`. The home screen (`phase === "intro"`) is fully restructured; the play/result screens are reskinned in place.

### 1. Home (`phase === "intro"`)
Replace the current two-column setup/progress grid entirely. New vertical flow, centered, max-width ~1120px:

**a. Hero (centered column)**
- `Pitchcraft.` — Spectral 500, ~74px, `var(--ink)`, the `.` in `var(--amber)`.
- Tagline (Spectral italic 300, ~22px, `var(--ink-dim)`, max-width 560, centered): *"Your voice is an instrument you already carry. Come play with it — no lessons, no pressure. Just sing out and see what happens."*
- **Voice chip button** (pill, `var(--chip)` bg, `var(--line)` border, mono uppercase, `var(--ink-dim)`): a 7px `var(--amber)` dot + `Singing as {voiceLabel} · change`. Opens the **voice picker overlay**. Hover → border `var(--amber)`, text `var(--ink)`.
- Directly **below the chip**, a mono note (~11px, `var(--ink-faint)`): *"Headphones recommended · audio never leaves your device"*. (This lives here, not in a footer.)

**b. Onramp banner** (only when `showOnramp`, default true) — horizontal card, `var(--panel)` bg, `var(--line)` border, 14px radius, padding 20/24:
- Left: a 96×72 rounded window (`#14100b` bg) running a **small Range Explorer preview** (the flower).
- Middle: mono coral kicker `New here? Start here`; Spectral ~20px `var(--ink)` *"First, let's find where your voice lives."*; `var(--ink-dim)` ~14.5px *"Sing high, sing low — a flower blooms across your range and tells you which voice type is yours. Takes about a minute."*
- Right: solid `var(--coral)` button, dark text (`#1a140c`), mono uppercase, *"Explore your range"* → launches Range Explorer (`startRange`). Hover → `translateY(-2px)`.

**c. "Ways to play"** — heading row (Spectral 500 ~26px `Ways to play` + mono faint `pick one and sing`), then a **3-column grid** (`1fr 1fr 1fr`, gap 18) of the three playful games **in this order: Range Explorer, Voice Garden, Chroma Loom**. Each card:
- Wrapper: `background: transparent`, `1px var(--card-line)`, radius 16, `overflow:hidden`, hover lift + border `{accent}`. `cursor:pointer`, whole card opens that game's intro.
- Top: 150px-tall preview window (`#14100b`) running the game's **live preview** (see "Card live previews"). Range Explorer card shows a small pill tag `start here` (mono, dark text on `var(--coral)`, top-left).
- Bottom label block: `padding:18px 20px 20px`, **`background: rgba(0,0,0,0.3)`** (semitransparent black tint so the dawn bg shows through). Name in Spectral ~19px **`#ffffff`** + accent glyph; blurb Spectral ~14.5px **`rgba(255,255,255,0.82)`**; then mono uppercase accent `Play →`.
- Glyphs & blurbs:
  - **Range Explorer** `❀` — *"Sing high, sing low. A flower blooms across your range and shows you which voice is yours."*
  - **Voice Garden** `❦` — *"Every tone you sing grows something — mushrooms, wildflowers, trees. A living garden that remembers you."*
  - **Chroma Loom** `✺` — *"Watch your voice become light. A rainbow loom weaves every sound you make into moving colour."*

**d. "Train your ear"** — its own section (heading row: Spectral 500 ~26px `Train your ear` + mono faint `structured practice, at your pace`), then a **2-column grid `1.5fr 1fr`, gap 18**, both cells the same height:
- **Left — The Trainer feature card:** same construction as a game card (150px live piano-roll preview on top, `rgba(0,0,0,0.3)` label block, white text). Name `The Trainer ♪`, blurb *"Hear a note, then find it in your voice. Friendly drills that meet you where you are and grow with you."*, footer mono amber `Choose a level & play →`. Opens the Trainer intro (level picker lives there).
- **Right — Your practice card:** `rgba(0,0,0,0.3)` bg, `var(--card-line)` border, radius 16, `display:flex; gap:18`, hover lift + amber border, opens the **practice overlay**. Left column (flex:1): mono kicker `rgba(255,255,255,0.6)` `Your practice`; Spectral 18px `#fff` *"Your pitch, note by note"*; ~13px `rgba(255,255,255,0.72)` *"How flat or sharp you land on each note, and how steady your pitch is — kept quietly across every visit."*; spacer; mono amber `Open your practice →`. Right column: a **fixed ~132px-wide dark window (`#0c0d12`)** holding a **miniature one-octave** `drawPitchGraph` (see "Mini pitch graph"). The card stretches to match the Trainer card's height (grid `align-items: stretch`; don't force a min-height on the canvas).

No bottom footer on home.

### 2. Voice picker overlay (`showVoice`)
Full-screen scrim (`var(--scrim)`), centered modal (max-width 620, `var(--panel)`, radius 18, padding 30/32, scrollable). Click scrim to close; stop propagation on the panel.
- Header: Spectral 500 ~26px *"Which voice is yours?"* + `var(--ink-dim)` sub *"Pick the one that fits — you can change it anytime. Not sure? Let a game find it for you."*; × close.
- 2-col grid of the six voices (display order: soprano, tenor, mezzo, baritone, contralto, bass). Each option: `var(--panel2)` (or `var(--chip)` + `var(--amber)` border when selected), radius 11, padding 13/15; label Spectral 17px, mono range (e.g. `C4–C6`) right-aligned faint, italic desc below. Warm plain-language descriptions:
  - Soprano — *a bright, high voice* — C4–C6
  - Tenor — *a high, ringing voice* — C3–E5
  - Mezzo-Soprano — *a warm middle voice* — A3–F5
  - Baritone — *a full, mid-low voice* — G2–E4
  - Contralto — *a low, rich voice* — F3–E5
  - Bass — *a deep, resonant voice* — E2–E4
- Full-width dashed-coral button at the bottom: *"Not sure? Explore your range ❀"* → closes overlay, launches Range Explorer.
- Selecting a voice sets `voiceId`, persists prefs (existing `persistPrefs`), closes overlay.

### 3. Practice overlay (`showPractice`)
Scrim + modal (max-width 560). Header Spectral 500 ~24px *"Your practice, gently kept"* + sub *"No leaderboards, no pressure. Just quiet proof that you keep showing up."* Three stat tiles (`var(--panel2)`, mono): **day streak · visits · best** (best in `var(--amber)`) — wire to the real `stats` (streak, sessions, `bestFor(...)`). Below, a small labeled bar row (mono kicker `Notes you've grown steady on`) OR reuse the full `drawPitchGraph` here at larger size — your call; the home card already carries the mini graph. Keep it gentle/quiet, not a dashboard.

### 4. Play chrome (all four games, reskinned in place)
Keep the existing HUD-row / stage / footer structure; only restyle:
- HUD row: three columns. Left (label + big mono number + small), center (accent pill + big Spectral target in `{accent}` + mono sub), right (`You` + big mono + small). Use tokens; pills use `var(--chip)` + `{accent}` border.
- Stage: `1px var(--line)`, radius 14, `overflow:hidden`, canvas interior stays dark (see remap). Timer bar at bottom uses `{accent}` fill.
- Footer: mono faint hint (left) + a bordered ghost button (right) — labels per game: Trainer `Quit round`, Range `Show my range`, Garden `Rest the garden`, Loom `Leave the loom`.
- Existing overlays (before-you-begin intro card, done recap, range verdict, garden recap) get the warm panel/token treatment; keep their copy.

### 5. Game intro cards
The current per-game "before you begin" overlays stay, warmed. The **Trainer intro** additionally hosts the **level picker** (Training + LV1–4) and the voice chip; the **Garden intro** hosts the voice chip. Level pills: `var(--panel2)` / selected `var(--chip)`+`var(--amber)`, mono tag (`WARM UP`, `LV 1`…) + Spectral title. Warm level one-liners:
- Training — *A gentle guided scale — five notes, with a tone to lean on.*
- Beginner (LV1) — *Short three-note tunes, sung back from memory.*
- Practiced (LV2) — *Five-note tunes across your chosen range.*
- Accomplished (LV3) — *Seven-note tunes over your full range.*
- Expert (LV4) — *Eight notes — and the pitch is hidden. Trust your ear.*

### 6. Results
Reskin the existing recap/verdict panels with warm tokens; headline number/label in `{accent}`, gentle encouraging copy, `again` + `Return home` buttons. Keep the Range Explorer `RangeChart` SVG; recolor: your-range band `rgba(0,0,0,0.28)`→ token neutral, matched female = `var(--amber)`, matched male = `var(--sage)` (or keep teal if you prefer semantic continuity).

---

## Card live previews (the key new feature)
Each home card/onramp shows a **real, moving sliver** of its game. Implement with the **actual engines**, not decorative fakes, so they're authentic and free of extra code:

- Render a small `<canvas>` per card and attach it via each engine's existing `setCanvas(el)` ref pattern.
- Run each engine in a **preview / ambient mode**: no mic, no scoring, no HUD callbacks — just the visual loop drawing a gentle scripted/idle scene. Add a lightweight `previewMode` (or `demo()` entry) to each engine that:
  - **rangeEngine** — draws the flower with a few petals gently pulsing/blooming (feed synthetic sustained "held" bins on a slow loop instead of mic pitch).
  - **engine (trainer)** — draws the piano-roll scrolling with a couple of target blocks crossing the playhead and a synthetic tracing dot (drive `draw()` from a fake note sequence + a sine "your pitch").
  - **gardenEngine** — draws the night scene with stars, a slowly growing plant, and a drifting firefly/butterfly (spawn one scripted growth on a loop; no persistence writes).
  - **loomEngine** — weaves the ribbon from synthetic spectrum data (a moving low→high sweep) so colour scrolls.
- Keep previews cheap: cap DPR at ~2, small canvases, pause with `IntersectionObserver`/`visibilitychange` when offscreen or tab hidden, and tear down on unmount.
- Card interiors stay **dark** (`#14100b`) regardless of theme — they're little lit "windows," which reads intentionally across all three palettes and avoids theming the canvases.

If wiring the real engines into preview mode is too costly for a first pass, port the prototype's four `draw*` routines from `Pitchcraft Warm.dc.html` (`drawFlower`, `drawRoll`, `drawGarden`, `drawLoom`) as a temporary decorative fallback — but the real-engine path is preferred.

## Mini pitch graph (practice card)
Reuse `src/game/pitchGraph.ts` `drawPitchGraph` for the practice-card thumbnail, with these adjustments for a tight, one-octave miniature:
- Domain: **one octave**, `lo = 60` (C4), `hi = 72` (C5); `dLow = lo - 0.7`, `dHigh = hi + 0.7`.
- Compact chrome: gutter ~23px, header ~22px; drop the "semitones off" caption (too wide); keep just `flat` / `sharp` end labels and the strong 0¢ centerline; naturals + sharps labelled down the gutter (there's room at one octave).
- Bars: per-note mean±std, colored by `colorForCents` (amber at 0, teal flat, coral sharp) — unchanged.
- Feed it real recent per-note stats scoped to the current voice/level when available (`recentNoteStats`), else a representative sample.
- Canvas interior stays `#0c0d12`.

## Canvas color remap (engines)
The accuracy semantics — **amber = on pitch, teal = flat / preview / vibrato, coral = sharp** — are meaningful; **keep them**. Only warm the neutral canvas scaffolding:
- Stage/canvas fill `#0c0d12` / `#0a0b0f` → keep dark, but you may nudge to a warm charcoal `#14100b` for consistency with the card windows.
- Gridlines/labels `rgba(255,255,255,…)` → fine as-is on dark; if you move to warm-light/dawn stages, invert to `rgba(0,0,0,…)`. (Simplest: keep stages dark in all themes, like the card windows.)
- The trainer accent `#F4B23E` inside the roll can stay literal, or read `--amber` — but since the accent hex is identical to warm-dark's amber, leaving it is fine.

## Interactions & behavior
- Whole cards are clickable (open intro / launch game / open overlay). Hover: `translateY(-3/-4px)` + border→accent, 0.18s ease.
- Overlays: scrim click closes; panel click stops propagation; × closes. Fade-in ~0.25s.
- Buttons: solid accent (dark text) primary; bordered ghost secondary; hover `translateY(-2px)`.
- Section/card entrance: fade / rise ~0.4–0.5s.
- Preserve all existing engine start/stop, mic-permission, back-button, and persistence flows.

## State management
- Existing: `phase`, `voiceId`, `level`, `stats`, `history`, per-game huds/results, `micError`, `showIntro`, loom rainbow/pattern, garden refs. Keep all.
- Add: `showVoice: boolean`, `showPractice: boolean` for the two new overlays.
- Add a `theme` value (`"dawn" | "warm-dark" | "warm-light"`, default `"dawn"`) applied as `data-theme` on the page root; optionally persist in prefs. (Optional: expose as a small setting; not required for v1.)

## Files in this bundle
- `Pitchcraft Warm.dc.html` — the high-fidelity design reference (all screens, overlays, live-preview draw routines, mini pitch graph, three themes). Open it in a browser to see look + behavior; treat as the visual source of truth.

## Acceptance
- Home leads with play: hero → onramp → 3 game cards → "Train your ear" (Trainer + practice) — no stats grid up front, no bottom footer.
- Dawn is the default palette; warm-dark/warm-light selectable via `data-theme`; all three read cleanly.
- Card labels are 30%-black-tinted with white text; card interiors are dark live-preview windows using the real engines.
- Voice-type selection is a warm overlay with plain-language descriptions and a "Not sure? Explore your range" path.
- Practice moved off the entry into a card (mini one-octave pitch graph) + overlay.
- Play/intro/results chrome reskinned with tokens; **no gameplay/algorithm changes**; accuracy color semantics preserved.
- Type: Spectral for prose/headings, mono only for labels/numbers/note-names.
