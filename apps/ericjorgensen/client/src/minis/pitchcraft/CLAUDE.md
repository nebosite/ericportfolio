# Pitchcraft — build guide for Claude

You are implementing **Pitchcraft**, a single-page browser game that helps beginning
singers learn to hear a pitch and match it with their voice. It is one page of Eric
Jorgensen's portfolio, linked under the **"Pure AI Output"** section. This folder is
self-contained: it holds a working visual reference, the core game logic as plain
TypeScript, and this spec. Build the real page from these.

## What to build

A self-contained page/route (its own folder/component) that:

1. Lets the player pick a **voice range** and a **difficulty level**.
2. Uses the **real microphone** to detect the singer's pitch in real time.
3. Plays target notes on a horizontal **piano-roll** (pitch = vertical lanes, time
   scrolls right→left through a fixed playhead). Each note is announced by name
   (chromatic notation, e.g. `D#4`) and in Hz.
4. Scores how closely and steadily the player matches each note, with a vibrato bonus.
5. Tracks history/progress in **IndexedDB**; high scores go to a server (stub provided).

The target stack is the rest of the site: **React + Vite + TypeScript**. The modules
in `src/` are framework-agnostic — import them as-is and wrap the game loop in a React
component. Do not rewrite the algorithms; they are tuned and correct.

## Reference files

- `reference/Pitchcraft.dc.html` — the **visual + behavioral reference** (the approved
  prototype). It was authored in a design tool and depends on that tool's runtime, so
  use it to see the intended look, layout, copy, colors, and game feel — not as code to
  run directly. Recreate its UI in the real stack.
- `src/` — the **logic to use directly** (see File map). These are plain TS, no deps.

## Core gameplay

### Note cycle (every target note runs this 11-second cycle)

| Phase        | Length | What happens                                                                   | Scoring |
| ------------ | ------ | ------------------------------------------------------------------------------ | ------- |
| Rest         | 2s     | silence, breathe                                                               | no      |
| Preview      | 2s     | a **pure sine tone** of the upcoming note plays so the player hears the target | no      |
| Prep         | 2s     | silence — player finds the note in their voice                                 | no      |
| Sing (score) | 5s     | the target block reaches the playhead; player sustains the note                | **yes** |

The block scrolls in from the right during rest/preview/prep and aligns with the
playhead exactly when the Sing phase begins. The HUD shows the current phase
(Breathe → Listen → Get ready → Sing). During Preview, tint the upcoming block teal
and mark it with a ♪.

### Scoring (only during the 5s Sing phase, evaluated every 100ms)

Let `cents = 1200 * log2(detectedHz / targetHz)`, `ac = |cents|`.

- `ac ≤ 25` (within ⅛ step) → **5 pts** per 100ms
- `ac ≤ 50` (within ¼ step) → **2 pts** per 100ms
- `ac ≤ 100` (within a semitone) → **1 pt** per 100ms
- otherwise → 0

**Vibrato bonus ×10:** while the player holds a vibrato — pitch stays within a
semitone of the target and crosses the target frequency at a regular rate of **≥5
times per second** — multiply the per-tick points by 10. (See `VibratoDetector` in
`src/game/scoring.ts`: it requires ≥5 zero-crossings/sec, peak-to-peak 30–320 cents,
mean deviation < 110 cents over a ~1.1s window.)

### Voice ranges (MIDI; C4 = 60)

| Voice                      | Range | lo–hi MIDI |
| -------------------------- | ----- | ---------- |
| Contralto (Low Female)     | F3–E5 | 53–76      |
| Mezzo-Soprano (Med Female) | A3–A5 | 57–81      |
| Soprano (High Female)      | C4–C6 | 60–84      |
| Tenor (High Male)          | C3–C5 | 48–72      |
| Baritone (Med Male)        | A2–A4 | 45–69      |
| Bass (Low Male)            | E2–E4 | 40–64      |

### Difficulty

- **Level 0 — Training:** a guided scale drill — the five notes centred on the range's
  sweet spot `[center-2, center+2]`, played up then down with a guide tone (the only
  level that uses the rest/preview/prep/sing note cycle and `buildSequence`).
- **Levels 1–4 — tune levels:** each plays **10 short made-up tunes**; you hear a tune,
  then sing it back from memory (no guide tone during the sing). Every tune is stretched
  to **5 seconds** regardless of note count (`buildTunePlan`/`buildTune`, `TUNE_COUNT`,
  `TUNE_SECONDS`, `notesPerTune`, `tuneBand`). Note band and tune length per level:
  - **1 — Beginner:** an octave starting 25% up from the bottom `[lo+25%, +12]`; 3-note tunes.
  - **2 — Intermediate:** bottom of the range up to 25% below the top `[lo, hi-25%]`; 5-note tunes.
  - **3 — Accomplished:** the full range `[lo, hi]`; 7-note tunes.
  - **4 — Expert:** the full range plus two each end `[lo-2, hi+2]`; 8-note tunes, and the
    pitch target is **hidden** — dim full-height timing columns replace the note bars so
    the visual can't be used to check pitch.

Note: pitch detection is clamped to 70–1250 Hz so Soprano's C6 (~1046 Hz) registers
with headroom. The live detector (`detectVoicePitch`) deduces the fundamental from
the harmonic set (not the lowest peak) so a high note whose fundamental partial is
weak/masked doesn't read an octave high; a per-frame median octave-snap catches
residual single-frame flips.

## Persistence

- **IndexedDB** database `pitchcraft` (see `src/storage/history.ts`):
  - object store `history` (keyPath `id`, autoIncrement): one record per finished
    session `{ ts, d (YYYY-MM-DD), score, accuracy, voice, level }`.
  - object store `kv`: aggregate `stats` under key `"stats"` —
    `{ sessions, best, streak, lastDate, notes: { [midi]: {n,rSum,best,pts} }, prefs }`.
    `notes` powers the per-note "pitch map" mastery; `streak` is consecutive-day play;
    `prefs` remembers the last voice/level.
- **Server high scores:** `submitHighScore(record)` POSTs to
  `import.meta.env.VITE_PITCHCRAFT_API + '/highscores'` when configured, else no-ops.
  Implement the real leaderboard endpoint on the site's backend; keep the local best
  as fallback. (The prototype used `window.PITCHCRAFT_API`; switch to the Vite env var.)

## Design system (rhymes with the portfolio, but uses more color)

- **Background:** near-black studio — `radial-gradient(1200px 600px at 50% -10%, #15171f, #0a0b0f 60%)`.
- **Type:** `Spectral` (display, weights 300/400/500; italic for taglines) and
  `Spline Sans Mono` (labels, numbers, note names — uppercase, letter-spaced).
- **Accent (single, intensifying):** amber `#F4B23E` — used for the on-pitch glow,
  growing from gray `#4a5060` (far) → amber → white-hot core when within ⅛ step.
- **Secondary:** teal `#35C4B5` — the preview tone and the vibrato ×10 state only.
- **Neutrals:** panels `#101218`/`#16181f`, borders `#23262f`, text `#c9cdd6`,
  dim `#8a90a0`/`#6b7180`, error `#E8654A`. Square corners (radius ≤ 5px), no heavy shadow.
- **Layout:** ≤1080px column. Intro = setup card (voice grid + difficulty + start) beside
  a progress card (streak/sessions/best, pitch map, recent-scores sparkline). Playing =
  HUD row (score+multiplier | target note+phase+Hz | your note+cents) over the canvas
  piano roll with a thin timer bar. Summary = score/accuracy/vibrato/best-note + pitch map.

### Piano-roll canvas (60fps, `<canvas>` — don't try to do this in DOM)

- Vertical axis = pitch; map `[lo-1.5, hi+1.5]` MIDI to full height. Draw a faint line per
  semitone (sharps fainter), label naturals on the left, C's brightest.
- Playhead = vertical line at x ≈ 27% of width. `pxPerSec ≈ width*0.72/7`.
- Target blocks scroll from the right; bright amber during Sing, teal+♪ during Preview,
  dim amber otherwise. During Sing, draw a dashed target line and highlight the lane.
- Player's live pitch = a glowing dot at the playhead (y = detected pitch), with a short
  trailing ribbon to the left colored by recent accuracy. Glow/size grow with closeness;
  white core + ring within ⅛ step; dot turns teal during vibrato.
- Ambient touch: a faint FFT spectrum along the bottom from a second AnalyserNode.

## File map (`src/`)

- `audio/pitch.ts` — `detectVoicePitch(buf, sampleRate)` (FFT harmonic-set matcher:
  finds the peaks, groups them by a common fundamental, and reports the DEDUCED
  fundamental with a consecutive-harmonic guard) and `PitchAnalyser` (wraps an
  `AnalyserNode`, adds the per-frame octave-snap/smoothing, returns Hz per frame).
  `autoCorrelate` is an older ACF detector kept for reference; the game uses
  `detectVoicePitch`.
- `audio/tone.ts` — `TonePlayer` (click-free sine preview of a target note).
- `game/notes.ts` — note math (`midiName/midiHz/hzMidi`), `VOICES`, `LEVELS`,
  `noteSet(voiceId, level)`, `buildSequence(set)`, cycle timing + `phaseOf`.
- `game/scoring.ts` — `quality(cents)`, scoring constants, `VibratoDetector`.
- `storage/history.ts` — IndexedDB stats/history + `submitHighScore` stub.

## Acceptance checklist

- [ ] Mic permission requested on Start; graceful message if denied.
- [ ] Pure tone plays for 2s before each note; no scoring until the Sing phase.
- [ ] Scoring matches the cents thresholds and vibrato ×10 exactly.
- [ ] Note set + sequence (up/down/shuffle ×3) correct for each voice/level.
- [ ] History persists in IndexedDB; prefs restored on reload; pitch map reflects mastery.
- [ ] `submitHighScore` wired to the backend (or clearly stubbed) — no secrets in client.
- [ ] Audio fully stops (tracks + context) when leaving the page / ending a session.
