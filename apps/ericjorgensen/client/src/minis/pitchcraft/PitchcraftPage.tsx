import { useEffect, useRef, useState, CSSProperties } from "react";
import { Link } from "react-router-dom";
import FeedbackPanel from "../../components/FeedbackPanel";
import SiteFooter from "../../components/SiteFooter";
import { PitchcraftEngine, Hud, SessionResult, MicError, blankHud } from "./engine";
import { RangeExplorerEngine, RangeHud, blankRangeHud } from "./rangeEngine";
import { VoiceGardenEngine, GardenHud, GardenRecap, blankGardenHud } from "./gardenEngine";
import { ChromaLoomEngine, LoomHud, blankLoomHud } from "./loomEngine";
import { DEFAULT_RAINBOW, PATTERNS, LoomPatternId, getPattern } from "./src/game/chromaLoom";
import { RangeResult, spanText } from "./src/game/rangeFlower";
import { Garden, emptyGarden } from "./src/game/voiceGarden";
import { trackEvent } from "../../lib/analytics";
import { useEngagement } from "../../lib/engagement";
import {
  VOICES,
  LEVELS,
  VoiceId,
  LevelId,
  noteSet,
  midiName,
  notesPerTune,
} from "./src/game/notes";
import { drawPitchGraph, meanStd, niceAxisStep, GraphBar } from "./src/game/pitchGraph";
import {
  Stats,
  SessionRecord,
  NoteCents,
  DEFAULT_STATS,
  loadStats,
  saveStats,
  loadHistory,
  loadGarden,
  saveGarden,
  addHistory,
  applySession,
  submitHighScore,
  bestFor,
  recentNoteStats,
  recentScorePoints,
} from "./src/storage/history";
import styles from "./PitchcraftPage.module.css";

const MONO = "'Spline Sans Mono', monospace";
const SERIF = "'Spectral', Georgia, serif";

// Female (col 1) highest→lowest, Male (col 2) highest→lowest, interleaved for the 2-col grid.
const VOICE_DISPLAY_ORDER: VoiceId[] = [
  "soprano",
  "tenor",
  "mezzo",
  "baritone",
  "contralto",
  "bass",
];

type Phase = "intro" | "playing" | "done" | "range" | "rangeDone" | "garden" | "gardenDone" | "loom";

// The loom's rainbow key colors persist across visits (palette-tuning is fiddly
// work worth keeping). Anything malformed falls back to the default rainbow.
const LOOM_RAINBOW_KEY = "pitchcraft-loom-rainbow";

function loadLoomRainbow(): string[] {
  try {
    const raw = window.localStorage.getItem(LOOM_RAINBOW_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (
        Array.isArray(arr) &&
        arr.length === DEFAULT_RAINBOW.length &&
        arr.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
      ) {
        return arr as string[];
      }
    }
  } catch {
    /* unavailable or corrupt — use the defaults */
  }
  return [...DEFAULT_RAINBOW];
}

function persistLoomRainbow(colors: string[]): void {
  try {
    window.localStorage.setItem(LOOM_RAINBOW_KEY, JSON.stringify(colors));
  } catch {
    /* storage unavailable — the session still works */
  }
}

const label: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#6b7180",
};

export default function PitchcraftPage() {
  useEngagement("pitchcraft");
  const engineRef = useRef<PitchcraftEngine | null>(null);
  const rangeRef = useRef<RangeExplorerEngine | null>(null);
  const gardenEngineRef = useRef<VoiceGardenEngine | null>(null);
  const loomRef = useRef<ChromaLoomEngine | null>(null);
  // The persistent Voice Garden, loaded once and saved after every growth.
  const gardenRef = useRef<Garden>(emptyGarden());
  const statsRef = useRef<Stats>({ ...DEFAULT_STATS });

  const [phase, setPhase] = useState<Phase>("intro");
  const [voiceId, setVoiceId] = useState<VoiceId>("contralto");
  const [level, setLevel] = useState<LevelId>(1);
  const [stats, setStats] = useState<Stats>({ ...DEFAULT_STATS });
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [hud, setHud] = useState<Hud>(blankHud());
  const [micError, setMicError] = useState<MicError | null>(null);
  // The "before you begin" card fades in over the stage on start; the note
  // session waits until the player dismisses it (see startSession / dismissIntro).
  // The Range Explorer game reuses it for its own intro card.
  const [showIntro, setShowIntro] = useState(false);
  const [rangeHud, setRangeHud] = useState<RangeHud>(blankRangeHud());
  const [rangeResult, setRangeResult] = useState<RangeResult | null>(null);
  const [gardenHud, setGardenHud] = useState<GardenHud>(blankGardenHud());
  const [gardenRecap, setGardenRecap] = useState<GardenRecap | null>(null);
  const [loomHud, setLoomHud] = useState<LoomHud>(blankLoomHud());
  const [loomPattern, setLoomPattern] = useState<LoomPatternId>("ribbon");
  const [loomColors, setLoomColors] = useState<string[]>(loadLoomRainbow);
  // The garden's light: pointer-steered by default; checked = rhythm sweep.
  const [rhythmLight, setRhythmLight] = useState(false);
  // Two-step confirm for clearing the garden (armed briefly, then relaxes).
  const [confirmClear, setConfirmClear] = useState(false);

  // Load saved stats/history and restore the last voice/level.
  useEffect(() => {
    let alive = true;
    Promise.all([loadStats(), loadHistory(), loadGarden()]).then(([s, h, g]) => {
      if (!alive) return;
      statsRef.current = s;
      setStats(s);
      setHistory(h);
      gardenRef.current = g;
      if (s.prefs?.voiceId) setVoiceId(s.prefs.voiceId as VoiceId);
      if (s.prefs?.difficulty) setLevel(s.prefs.difficulty as LevelId);
    });
    return () => {
      alive = false;
      engineRef.current?.destroy();
      rangeRef.current?.destroy();
      gardenEngineRef.current?.destroy();
      loomRef.current?.destroy();
    };
  }, []);

  // Browser Back during a round: a press while playing quits it (→ the "done"
  // recap), and a press on the recap returns home. A guard history entry is
  // pushed on entry and re-armed after quitting, so Back keeps being caught until
  // we reach home. phaseRef lets the (dep-stable) listener read the live phase.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const inRound = phase !== "intro";
  useEffect(() => {
    if (!inRound) return;
    window.history.pushState({ pitchcraft: true }, "");
    const onPop = () => {
      if (phaseRef.current === "playing") {
        engineRef.current?.stop(); // quit → "done" recap
        window.history.pushState({ pitchcraft: true }, ""); // re-arm for the next Back
      } else if (phaseRef.current === "range") {
        rangeRef.current?.finish(); // quit exploring → range verdict
        window.history.pushState({ pitchcraft: true }, "");
      } else if (phaseRef.current === "garden") {
        gardenEngineRef.current?.finish(); // rest the garden → visit recap
        window.history.pushState({ pitchcraft: true }, "");
      } else if (phaseRef.current === "loom") {
        const secs = loomRef.current?.finish() ?? 0; // no recap — straight home
        trackEvent("game_over", { game: "chroma_loom", seconds: Math.round(secs) });
        returnHome();
      } else {
        returnHome(); // recap → home
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [inRound]);

  const persistPrefs = (vid: VoiceId, lvl: LevelId) => {
    const w = statsRef.current;
    w.prefs = { voiceId: vid, difficulty: lvl };
    void saveStats(w);
  };
  const chooseVoice = (id: VoiceId) => {
    setVoiceId(id);
    persistPrefs(id, level);
  };
  const chooseLevel = (n: LevelId) => {
    setLevel(n);
    persistPrefs(voiceId, n);
  };

  const handleEnd = async (result: SessionResult) => {
    // Keep the engine reference so its frozen graph stays drawn during "done";
    // it's torn down in returnHome().
    const w = statsRef.current;
    const { date } = applySession(w, {
      score: result.score,
      perNote: result.perNote,
      voiceId,
      difficulty: level,
    });
    setStats({ ...w });
    await saveStats(w);
    // Compact per-note cents map for this session (feeds the recent pitch graph).
    const notes: Record<string, NoteCents> = {};
    for (const m in result.perNote) {
      const pn = result.perNote[m];
      if (pn.cN > 0) notes[m] = { cN: pn.cN, cSum: pn.cSum, cSqSum: pn.cSqSum };
    }
    const rec: SessionRecord = {
      ts: Date.now(),
      d: date,
      score: result.score,
      accuracy: result.accuracy,
      voice: voiceId,
      level,
      notes,
    };
    await addHistory(rec);
    submitHighScore(rec);
    setHistory((h) => [...h, rec].slice(-200));
    // Stay on the level page so the player can study their pitch graph, then
    // return home via the button (see the "done" overlay).
    setPhase("done");
  };

  // Leave the finished level (or game) and go back to the home screen.
  const returnHome = () => {
    engineRef.current?.destroy();
    engineRef.current = null;
    rangeRef.current?.destroy();
    rangeRef.current = null;
    setRangeResult(null);
    gardenEngineRef.current?.destroy();
    gardenEngineRef.current = null;
    setGardenRecap(null);
    loomRef.current?.destroy();
    loomRef.current = null;
    setPhase("intro");
  };

  const startSession = () => {
    const engine = new PitchcraftEngine({
      voiceId,
      level,
      onHud: setHud,
      onEnd: handleEnd,
    });
    engineRef.current = engine;
    setMicError(null);
    setHud(blankHud());
    setShowIntro(true);
    setPhase("playing");
    // getUserMedia is invoked synchronously inside start(), preserving the click
    // gesture; the canvas mounts from the phase change and attaches via its ref.
    // The engine holds the note session until dismissIntro() calls begin().
    engine.start().catch((err: MicError) => {
      engine.destroy();
      engineRef.current = null;
      setShowIntro(false);
      setPhase("intro");
      setMicError(err === "denied" ? "denied" : "error");
    });
  };

  // Dismiss the intro card and let the note session start.
  const dismissIntro = () => {
    setShowIntro(false);
    engineRef.current?.begin();
  };

  const endSession = () => engineRef.current?.stop();

  // ---- Range Explorer game ----

  const handleRangeEnd = (result: RangeResult | null) => {
    setRangeResult(result);
    setPhase("rangeDone");
    trackEvent("game_over", {
      game: "range_explorer",
      span: result ? result.hiMidi - result.loMidi : 0,
      voice: result?.voice.id ?? "none",
    });
  };

  const startRange = () => {
    rangeRef.current?.destroy(); // a retry replaces the finished engine
    const engine = new RangeExplorerEngine({ onHud: setRangeHud, onEnd: handleRangeEnd });
    rangeRef.current = engine;
    setMicError(null);
    setRangeHud(blankRangeHud());
    setRangeResult(null);
    setShowIntro(true);
    setPhase("range");
    trackEvent("game_start", { game: "range_explorer" });
    engine.start().catch((err: MicError) => {
      engine.destroy();
      rangeRef.current = null;
      setShowIntro(false);
      setPhase("intro");
      setMicError(err === "denied" ? "denied" : "error");
    });
  };

  const dismissRangeIntro = () => {
    setShowIntro(false);
    rangeRef.current?.begin();
  };

  const finishRange = () => rangeRef.current?.finish();

  // Adopt the suggested voice as the session's voice range and head home.
  const adoptVoice = () => {
    if (rangeResult) chooseVoice(rangeResult.voice.id);
    returnHome();
  };

  // ---- Voice Garden ----

  const handleGardenEnd = (recap: GardenRecap) => {
    setGardenRecap(recap);
    setPhase("gardenDone");
    trackEvent("game_over", {
      game: "voice_garden",
      grown: recap.grown,
      total: recap.total,
    });
  };

  const startGarden = () => {
    gardenEngineRef.current?.destroy(); // a return visit replaces the rested engine
    const engine = new VoiceGardenEngine({
      voiceId,
      garden: gardenRef.current,
      onHud: setGardenHud,
      // Persist after every growth — the garden is a living archive, so
      // nothing sung is lost even if the tab closes mid-visit.
      onGrow: (g) => void saveGarden(g),
      onEnd: handleGardenEnd,
    });
    gardenEngineRef.current = engine;
    engine.setRhythm(rhythmLight);
    setMicError(null);
    setGardenHud(blankGardenHud());
    setGardenRecap(null);
    setShowIntro(true);
    setPhase("garden");
    trackEvent("game_start", { game: "voice_garden" });
    engine.start().catch((err: MicError) => {
      engine.destroy();
      gardenEngineRef.current = null;
      setShowIntro(false);
      setPhase("intro");
      setMicError(err === "denied" ? "denied" : "error");
    });
  };

  const dismissGardenIntro = () => {
    setShowIntro(false);
    gardenEngineRef.current?.begin();
  };

  const restGarden = () => gardenEngineRef.current?.finish();

  const toggleRhythmLight = (on: boolean) => {
    setRhythmLight(on);
    gardenEngineRef.current?.setRhythm(on);
  };

  // Clear the garden and start over. First click arms the button; a second
  // click within a few seconds actually clears (destructive, so confirm).
  const clearGarden = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    const g = gardenRef.current;
    g.elements = [];
    g.nextId = 1;
    g.createdTs = null;
    void saveGarden(g);
    gardenEngineRef.current?.refresh();
  };

  // ---- Chroma Loom ----

  const startLoom = () => {
    loomRef.current?.destroy(); // a return visit replaces the finished engine
    const engine = new ChromaLoomEngine({ rainbow: loomColors, onHud: setLoomHud });
    engine.setPattern(loomPattern);
    loomRef.current = engine;
    setMicError(null);
    setLoomHud(blankLoomHud());
    setShowIntro(true);
    setPhase("loom");
    trackEvent("game_start", { game: "chroma_loom" });
    engine.start().catch((err: MicError) => {
      engine.destroy();
      loomRef.current = null;
      setShowIntro(false);
      setPhase("intro");
      setMicError(err === "denied" ? "denied" : "error");
    });
  };

  const dismissLoomIntro = () => {
    setShowIntro(false);
    loomRef.current?.begin();
  };

  const leaveLoom = () => {
    const secs = loomRef.current?.finish() ?? 0;
    trackEvent("game_over", { game: "chroma_loom", seconds: Math.round(secs) });
    returnHome();
  };

  const chooseLoomPattern = (id: LoomPatternId) => {
    setLoomPattern(id);
    loomRef.current?.setPattern(id);
    trackEvent("loom_pattern_selected", { pattern: id });
  };

  const setLoomColor = (i: number, hex: string) => {
    const next = loomColors.slice();
    next[i] = hex;
    setLoomColors(next);
    persistLoomRainbow(next);
    loomRef.current?.setRainbow(next);
  };

  const resetLoomColors = () => {
    const next = [...DEFAULT_RAINBOW];
    setLoomColors(next);
    persistLoomRainbow(next);
    loomRef.current?.setRainbow(next);
  };

  const { lo, hi } = noteSet(voiceId, level);
  const levelTitle = LEVELS.find((l) => l.n === level)?.title ?? "";
  const planText =
    level === 0
      ? `Training · ${midiName(lo)}–${midiName(hi)} · 5 notes · up then down, guided`
      : `${levelTitle} · ${notesPerTune(level)}-note tunes × 10 · listen, then repeat from memory · ${midiName(lo)}–${midiName(hi)}${level === 4 ? " · pitch hidden" : ""}`;
  const mapRange = `${midiName(lo)}–${midiName(hi)}`;
  // Home pitch graph: the most recent 10 sessions for the selected voice + level.
  const recentNotes = recentNoteStats(history, voiceId, level, 10);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Top bar */}
        <div className={styles.topbar}>
          <Link to="/" className={styles.back}>
            ← Field Guide
          </Link>
          <div className={styles.badge}>
            <span className={styles.badgeText}>Pure AI Output</span>
            <span className={styles.badgeDot} />
          </div>
        </div>

        {/* Title */}
        <div style={{ marginTop: 14 }}>
          <h1 className={styles.title}>
            Pitchcraft<span style={{ color: "#F4B23E" }}>.</span>
          </h1>
          <p className={styles.tagline}>
            Hear the tone, then find it in your voice. A pitch-matching trainer that meets you in
            your range.
          </p>
        </div>

        {phase === "intro" && (
          <div className={styles.introGrid}>
            {/* Setup */}
            <div className={styles.card}>
              <div style={label}>Your voice</div>
              <div className={styles.voiceGrid}>
                {VOICE_DISPLAY_ORDER.map((vid) => {
                  const v = VOICES.find((x) => x.id === vid)!;
                  const sel = v.id === voiceId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={styles.opt}
                      style={optStyle(sel)}
                      onClick={() => chooseVoice(v.id)}
                    >
                      <div
                        style={{
                          fontFamily: SERIF,
                          fontSize: 17,
                          color: sel ? "#f3efe6" : "#b4b9c4",
                        }}
                      >
                        {v.label}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          letterSpacing: "0.04em",
                          color: sel ? "#b9863a" : "#565c6a",
                          marginTop: 3,
                        }}
                      >
                        {v.detail}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ ...label, marginTop: 24 }}>Games</div>
              <div className={styles.gamesGrid}>
                <button
                  type="button"
                  className={styles.opt}
                  style={optStyle(false)}
                  onClick={startRange}
                >
                  <div style={{ fontFamily: SERIF, fontSize: 17, color: "#b4b9c4" }}>
                    Range Explorer <span style={{ color: "#F4B23E" }}>❀</span>
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.04em",
                      color: "#565c6a",
                      marginTop: 3,
                    }}
                  >
                    Grow a flower with your voice — sing high and low, and it maps your range
                  </div>
                </button>
                <button
                  type="button"
                  className={styles.opt}
                  style={optStyle(false)}
                  onClick={startGarden}
                >
                  <div style={{ fontFamily: SERIF, fontSize: 17, color: "#b4b9c4" }}>
                    Voice Garden <span style={{ color: "#35C4B5" }}>❦</span>
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.04em",
                      color: "#565c6a",
                      marginTop: 3,
                    }}
                  >
                    A living archive of your voice — every tone you sing grows something, and the
                    garden keeps it
                  </div>
                </button>
                <button
                  type="button"
                  className={styles.opt}
                  style={optStyle(false)}
                  onClick={startLoom}
                >
                  <div style={{ fontFamily: SERIF, fontSize: 17, color: "#b4b9c4" }}>
                    Chroma Loom <span style={{ color: "#B653F7" }}>✺</span>
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.04em",
                      color: "#565c6a",
                      marginTop: 3,
                    }}
                  >
                    See your voice as light — a rainbow spectrogram weaves every sound you make
                    into a scrolling pattern
                  </div>
                </button>
              </div>

              <div style={{ ...label, marginTop: 24 }}>Difficulty</div>
              <div className={styles.levelGrid}>
                {LEVELS.map((lv) => {
                  const sel = lv.n === level;
                  return (
                    <button
                      key={lv.n}
                      type="button"
                      className={styles.opt}
                      style={optStyle(sel)}
                      onClick={() => chooseLevel(lv.n)}
                    >
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          letterSpacing: "0.08em",
                          color: sel ? "#F4B23E" : "#565c6a",
                        }}
                      >
                        {lv.n === 0 ? "TRAIN" : `LV ${lv.n}`}
                      </div>
                      <div
                        style={{
                          fontFamily: SERIF,
                          fontSize: 16,
                          color: sel ? "#f3efe6" : "#b4b9c4",
                          marginTop: 3,
                        }}
                      >
                        {lv.title}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 9.5,
                          letterSpacing: "0.03em",
                          color: sel ? "#b9863a" : "#565c6a",
                          marginTop: 4,
                          lineHeight: 1.3,
                        }}
                      >
                        {lv.detail}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className={styles.planBox}>{planText}</div>

              <button type="button" className={styles.startBtn} onClick={startSession}>
                Enable microphone &amp; start
              </button>
              {micError && (
                <p className={styles.err}>
                  {micError === "denied"
                    ? "Microphone blocked — allow mic access and retry."
                    : "Could not start audio. Check your mic and retry."}
                </p>
              )}
              <p className={styles.micNote}>
                Headphones recommended. Audio never leaves your device.
              </p>
            </div>

            {/* Progress */}
            <div className={styles.cardFlat}>
              <div style={label}>Your practice</div>
              <div className={styles.statsRow}>
                <Stat n={stats.streak} l="day streak" />
                <Stat n={stats.sessions} l="sessions" />
                <Stat n={bestFor(stats, voiceId, level)} l="best" accent />
              </div>

              <div
                style={{
                  ...label,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  margin: "22px 0 10px",
                }}
              >
                Your pitch · {mapRange} · last 10 sessions
              </div>
              <PitchGraph notes={recentNotes} voiceId={voiceId} level={level} height={500} />

              {history.length > 1 && (
                <>
                  <div
                    style={{
                      ...label,
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      margin: "22px 0 8px",
                    }}
                  >
                    Recent scores
                  </div>
                  <RecentScoresChart
                    history={history}
                    voiceId={voiceId}
                    level={level}
                    height={150}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {phase === "intro" && (
          <div className={styles.feedbackWrap}>
            <div className={styles.feedbackHeading}>Help shape Pitchcraft</div>
            <FeedbackPanel entity="pitchcraft" />
          </div>
        )}

        {(phase === "playing" || phase === "done") && (
          <div style={{ marginTop: 24 }}>
            <div className={styles.hudRow}>
              <div style={{ minWidth: 150 }}>
                <div style={{ ...label, fontSize: 10 }}>Score</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: "#f3efe6",
                    marginTop: 4,
                  }}
                >
                  {hud.score}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "4px 10px",
                    borderRadius: 20,
                    background: hud.multBg,
                    border: `1px solid ${hud.multBorder}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 500,
                      color: hud.multFg,
                    }}
                  >
                    {hud.multLabel}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: hud.multSub,
                    }}
                  >
                    {hud.multNote}
                  </span>
                </div>
              </div>

              <div style={{ textAlign: "center", flex: 1 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "3px 12px",
                    borderRadius: 20,
                    background: hud.phaseBg,
                    border: `1px solid ${hud.phaseBorder}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: hud.phaseColor,
                    }}
                  >
                    {hud.phaseLabel}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 500,
                    fontSize: 58,
                    lineHeight: 1,
                    color: hud.targetColor,
                    marginTop: 4,
                  }}
                >
                  {hud.targetName}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 14,
                    color: "#8a90a0",
                    marginTop: 2,
                  }}
                >
                  {hud.targetHz}
                  <span style={{ color: "#565c6a" }}> · {hud.noteCount}</span>
                </div>
              </div>

              <div style={{ minWidth: 150, textAlign: "right" }}>
                <div style={{ ...label, fontSize: 10 }}>You</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: hud.liveColor,
                    marginTop: 4,
                  }}
                >
                  {hud.liveName}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 14,
                    color: "#8a90a0",
                    marginTop: 8,
                  }}
                >
                  {hud.liveCents}
                </div>
              </div>
            </div>

            <div className={styles.board}>
              <div className={styles.stage}>
                <canvas ref={(el) => engineRef.current?.setCanvas(el)} className={styles.canvas} />
                {phase === "playing" && !showIntro && (
                  <div className={styles.stepsBadge}>
                    <div className={styles.stepsNum}>{hud.stepsLeft}</div>
                    <div className={styles.stepsUnit}>{hud.stepsUnit}</div>
                  </div>
                )}
                {phase === "playing" && hud.vibrato && (
                  <div className={styles.vibBadge}>Vibrato ×10</div>
                )}
                {showIntro && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>Before you begin</div>
                      <p className={styles.introText}>
                        It helps to be somewhere <em>quiet</em>, and to sing out with your full
                        voice — the way you&rsquo;d call a friend&rsquo;s name from across the
                        street. Don&rsquo;t hold back.
                      </p>
                      <p className={styles.introText}>
                        You&rsquo;ll hear a tone. When the colored bar crosses the play line, match
                        it by singing <em>&ldquo;ooo,&rdquo; &ldquo;ooh,&rdquo;</em> or{" "}
                        <em>&ldquo;aah&rdquo;</em> — loudly. A wiggly line traces your actual pitch,
                        and you earn more points the more of it you keep inside the bar.
                      </p>
                      <p className={styles.introText}>
                        Keep trying. Even practiced singers struggle with pitch, and you&rsquo;ll
                        get better over time. Challenge yourself to sing every day for two weeks and
                        watch your score change.
                      </p>
                      <button type="button" className={styles.introBtn} onClick={dismissIntro}>
                        I&rsquo;m ready — start singing
                      </button>
                    </div>
                  </div>
                )}
                {phase === "done" && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>Level complete</div>
                      <p className={styles.introText}>
                        Nice work. Look at the graph on the right{" "}
                        <span className={styles.arrow}>→</span> to see how <em>flat</em> or{" "}
                        <em>sharp</em> you landed on each note, and how steady your pitch was — the
                        wider the bar, the more it wandered.
                      </p>
                      <button type="button" className={styles.introBtn} onClick={returnHome}>
                        Return home
                      </button>
                    </div>
                  </div>
                )}
                {phase === "playing" && (
                  <div className={styles.timer}>
                    <div
                      className={styles.timerFill}
                      style={{
                        width: `${hud.timerPct}%`,
                        background: hud.targetColor,
                      }}
                    />
                  </div>
                )}
              </div>

              <div className={styles.graphSide}>
                <canvas
                  ref={(el) => engineRef.current?.setGraphCanvas(el)}
                  className={styles.graphCanvas}
                />
              </div>
            </div>

            {phase === "playing" && (
              <div className={styles.playFooter}>
                <div className={styles.hint}>
                  {level === 0
                    ? "Listen 2s · ready 2s · then sing · ⅛ step ×5 · ¼ ×2 · semitone ×1"
                    : "Listen to the short tune, then repeat it from memory"}
                </div>
                <button type="button" className={styles.endBtn} onClick={endSession}>
                  Quit round
                </button>
              </div>
            )}
          </div>
        )}

        {(phase === "range" || phase === "rangeDone") && (
          <div style={{ marginTop: 24 }}>
            <div className={styles.hudRow}>
              <div style={{ minWidth: 150 }}>
                <div style={{ ...label, fontSize: 10 }}>Petals</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: "#f3efe6",
                    marginTop: 4,
                  }}
                >
                  {rangeHud.petals}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a90a0", marginTop: 8 }}>
                  {rangeHud.heldSec.toFixed(0)}s held
                </div>
              </div>

              <div style={{ textAlign: "center", flex: 1 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "3px 12px",
                    borderRadius: 20,
                    background: "rgba(244,178,62,0.06)",
                    border: "1px solid #3a3320",
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "#b9863a",
                    }}
                  >
                    {phase === "range" ? "Explore" : "Your range"}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontWeight: 300,
                    fontSize: 21,
                    lineHeight: 1.35,
                    color: "#c9cdd6",
                    marginTop: 8,
                    maxWidth: 520,
                    marginLeft: "auto",
                    marginRight: "auto",
                  }}
                >
                  {phase === "range" ? rangeHud.prompt : "The flower you grew."}
                </div>
              </div>

              <div style={{ minWidth: 150, textAlign: "right" }}>
                <div style={{ ...label, fontSize: 10 }}>You</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: rangeHud.liveName === "—" ? "#565c6a" : "#f3efe6",
                    marginTop: 4,
                  }}
                >
                  {rangeHud.liveName}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, color: "#8a90a0", marginTop: 8 }}>
                  {rangeHud.liveHz || "silent"}
                </div>
              </div>
            </div>

            <div className={styles.board}>
              <div className={`${styles.stage} ${styles.stageWide}`}>
                <canvas ref={(el) => rangeRef.current?.setCanvas(el)} className={styles.canvas} />
                {showIntro && phase === "range" && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>Range Explorer</div>
                      <p className={styles.introText}>
                        Sing any note and <em>hold it</em>. A petal blooms where your pitch lands —
                        low notes glow red, high notes violet — and the longer you hold, the further
                        it grows.
                      </p>
                      <p className={styles.introText}>
                        Explore <em>low</em> and <em>high</em>. Push to the edges of your voice and
                        hold your strongest notes. When your flower is as big as you can make it,
                        we&rsquo;ll read it and suggest your singing range.
                      </p>
                      <button type="button" className={styles.introBtn} onClick={dismissRangeIntro}>
                        I&rsquo;m ready — let&rsquo;s explore
                      </button>
                    </div>
                  </div>
                )}
                {phase === "rangeDone" && rangeResult && (
                  <div className={styles.introCard}>
                    <div className={styles.rangeResultInner}>
                      <div className={styles.introKicker}>Your flower says&hellip;</div>
                      <div
                        style={{
                          fontFamily: SERIF,
                          fontWeight: 500,
                          fontSize: 40,
                          lineHeight: 1,
                          color: "#F4B23E",
                        }}
                      >
                        {rangeResult.voice.label}
                      </div>
                      <p className={styles.introText}>
                        You held notes from <em>{rangeResult.loName}</em> to{" "}
                        <em>{rangeResult.hiName}</em> — a span of{" "}
                        {spanText(rangeResult.loMidi, rangeResult.hiMidi)}. Your range against the
                        six voice types:
                      </p>
                      <RangeChart result={rangeResult} />
                      <div className={styles.rangeLegend}>
                        <span className={styles.rangeLegendItem}>
                          <i style={{ background: "#f3efe6" }} /> Your range
                        </span>
                        <span className={styles.rangeLegendItem}>
                          <i style={{ background: "#F4B23E" }} /> Best female ·{" "}
                          {rangeResult.female.label}
                        </span>
                        <span className={styles.rangeLegendItem}>
                          <i style={{ background: "#35C4B5" }} /> Best male ·{" "}
                          {rangeResult.male.label}
                        </span>
                      </div>
                      <div className={styles.introBtnRow}>
                        <button type="button" className={styles.introBtn} onClick={adoptVoice}>
                          Sing as {rangeResult.voice.label}
                        </button>
                        <button type="button" className={styles.introBtnGhost} onClick={returnHome}>
                          Return home
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {phase === "rangeDone" && !rangeResult && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>Keep exploring</div>
                      <p className={styles.introText}>
                        There wasn&rsquo;t enough <em>strongly sustained</em> singing to read a
                        range yet. Hold each note steady for a couple of seconds — a long, clear{" "}
                        <em>&ldquo;ahh&rdquo;</em> — and grow a few solid petals near each other.
                      </p>
                      <div className={styles.introBtnRow}>
                        <button type="button" className={styles.introBtn} onClick={startRange}>
                          Try again
                        </button>
                        <button type="button" className={styles.introBtnGhost} onClick={returnHome}>
                          Return home
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {phase === "range" && !showIntro && (
              <div className={styles.playFooter}>
                <div className={styles.hint}>
                  Hold a note to grow its petal · strongly-held notes set your range
                </div>
                <button type="button" className={styles.rangeFinishBtn} onClick={finishRange}>
                  I&rsquo;m done — show my range
                </button>
              </div>
            )}
          </div>
        )}

        {(phase === "garden" || phase === "gardenDone") && (
          <div style={{ marginTop: 24 }}>
            <div className={styles.hudRow}>
              <div style={{ minWidth: 150 }}>
                <div style={{ ...label, fontSize: 10 }}>Garden</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: "#f3efe6",
                    marginTop: 4,
                  }}
                >
                  {gardenHud.total}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a90a0", marginTop: 8 }}>
                  +{gardenHud.grown} this visit
                  {gardenHud.ageDays > 0 && (
                    <span style={{ color: "#565c6a" }}> · day {gardenHud.ageDays}</span>
                  )}
                </div>
              </div>

              <div style={{ textAlign: "center", flex: 1 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "3px 12px",
                    borderRadius: 20,
                    background: gardenHud.zoneLabel ? "rgba(53,196,181,0.1)" : "transparent",
                    border: `1px solid ${gardenHud.zoneLabel ? "#35C4B5" : "#23262f"}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: gardenHud.zoneLabel ? "#35C4B5" : "#6b7180",
                    }}
                  >
                    {phase === "gardenDone"
                      ? "The garden rests"
                      : gardenHud.zoneLabel || "Listening"}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontWeight: 300,
                    fontSize: 21,
                    lineHeight: 1.35,
                    color: "#c9cdd6",
                    marginTop: 8,
                    maxWidth: 520,
                    marginLeft: "auto",
                    marginRight: "auto",
                  }}
                >
                  {phase === "garden" ? gardenHud.prompt : "Everything you grew is kept."}
                </div>
              </div>

              <div style={{ minWidth: 150, textAlign: "right" }}>
                <div style={{ ...label, fontSize: 10 }}>You</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: gardenHud.liveName === "—" ? "#565c6a" : "#f3efe6",
                    marginTop: 4,
                  }}
                >
                  {gardenHud.liveName}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, color: "#8a90a0", marginTop: 8 }}>
                  {gardenHud.liveHz || "silent"}
                  {gardenHud.stabilityLabel && (
                    <span style={{ color: "#35C4B5" }}> · {gardenHud.stabilityLabel}</span>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.board}>
              <div className={`${styles.stage} ${styles.stageWide}`}>
                <canvas
                  ref={(el) => gardenEngineRef.current?.setCanvas(el)}
                  className={styles.canvas}
                />
                {showIntro && phase === "garden" && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>Voice Garden</div>
                      <p className={styles.introText}>
                        This garden is grown from your voice, and it <em>keeps</em> everything: each
                        visit adds to the last. The moment you sing, something starts growing where
                        the <em>light</em> falls — <em>low</em> notes weave mycelium that fruits
                        into mushrooms, <em>middle</em> notes raise grass and wildflowers,{" "}
                        <em>high</em> notes grow flowering trees and set butterflies loose.
                      </p>
                      <p className={styles.introText}>
                        Move the light with your pointer, or let it sweep to a rhythm. A steady tone
                        grows a clean shape; a wandering one grows something wild; the longer you
                        hold, the further it unfolds. New growth sprouts in front of old — what gets
                        buried returns to the soil, and the garden keeps changing.
                      </p>
                      <button
                        type="button"
                        className={styles.introBtn}
                        onClick={dismissGardenIntro}
                      >
                        Open the garden
                      </button>
                    </div>
                  </div>
                )}
                {phase === "gardenDone" && gardenRecap && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>The garden rests</div>
                      <div
                        style={{
                          fontFamily: SERIF,
                          fontWeight: 500,
                          fontSize: 44,
                          lineHeight: 1,
                          color: "#F4B23E",
                        }}
                      >
                        {gardenRecap.grown > 0
                          ? `${gardenRecap.grown} new ${gardenRecap.grown === 1 ? "thing" : "things"}`
                          : "A quiet visit"}
                      </div>
                      <p className={styles.introText}>
                        {gardenRecap.grown > 0 ? (
                          <>
                            This visit your voice grew <em>{recapBreakdown(gardenRecap.counts)}</em>
                            .{" "}
                          </>
                        ) : (
                          <>Nothing new took root this time — even so, the garden listened. </>
                        )}
                        Your garden holds {gardenRecap.total}{" "}
                        {gardenRecap.total === 1 ? "living thing" : "living things"}
                        {gardenRecap.ageDays > 1 && <> and is {gardenRecap.ageDays} days old</>}. It
                        will be here, exactly as you left it, whenever you return.
                      </p>
                      <div className={styles.introBtnRow}>
                        <button type="button" className={styles.introBtn} onClick={startGarden}>
                          Keep singing
                        </button>
                        <button type="button" className={styles.introBtnGhost} onClick={returnHome}>
                          Return home
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {phase === "garden" && !showIntro && (
              <div className={styles.playFooter}>
                <div className={styles.hint}>
                  Low → mushrooms · mid → grass &amp; flowers · high → trees · crowded plants fade
                </div>
                <div className={styles.footerControls}>
                  <button
                    type="button"
                    className={confirmClear ? styles.clearBtnArmed : styles.clearBtn}
                    onClick={clearGarden}
                  >
                    {confirmClear ? "Really clear everything?" : "Clear garden"}
                  </button>
                  <label className={styles.rhythmToggle}>
                    <input
                      type="checkbox"
                      checked={rhythmLight}
                      onChange={(e) => toggleRhythmLight(e.target.checked)}
                    />
                    Rhythm light
                  </label>
                  <button type="button" className={styles.rangeFinishBtn} onClick={restGarden}>
                    Rest the garden
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {phase === "loom" && (
          <div style={{ marginTop: 24 }}>
            <div className={styles.hudRow}>
              <div style={{ minWidth: 150 }}>
                <div style={{ ...label, fontSize: 10 }}>Pattern</div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: 30,
                    lineHeight: 1.1,
                    color: "#f3efe6",
                    marginTop: 6,
                  }}
                >
                  {getPattern(loomPattern).label}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a90a0", marginTop: 6 }}>
                  {getPattern(loomPattern).detail}
                </div>
              </div>

              <div style={{ textAlign: "center", flex: 1 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "3px 12px",
                    borderRadius: 20,
                    background: "rgba(182,83,247,0.08)",
                    border: "1px solid #3a2a4a",
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "#B653F7",
                    }}
                  >
                    Weaving
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontWeight: 300,
                    fontSize: 21,
                    lineHeight: 1.35,
                    color: "#c9cdd6",
                    marginTop: 8,
                    maxWidth: 520,
                    marginLeft: "auto",
                    marginRight: "auto",
                  }}
                >
                  Hum low, whistle high, slide between — every frequency you make becomes a thread
                  of light.
                </div>
              </div>

              <div style={{ minWidth: 150, textAlign: "right" }}>
                <div style={{ ...label, fontSize: 10 }}>You</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 42,
                    lineHeight: 1,
                    color: loomHud.liveName === "—" ? "#565c6a" : "#f3efe6",
                    marginTop: 4,
                  }}
                >
                  {loomHud.liveName}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, color: "#8a90a0", marginTop: 8 }}>
                  {loomHud.liveHz || "silent"}
                </div>
              </div>
            </div>

            <div className={styles.board}>
              <div className={`${styles.stage} ${styles.stageWide}`}>
                <canvas ref={(el) => loomRef.current?.setCanvas(el)} className={styles.canvas} />
                {showIntro && (
                  <div className={styles.introCard}>
                    <div className={styles.introInner}>
                      <div className={styles.introKicker}>Chroma Loom</div>
                      <p className={styles.introText}>
                        Sing, hum, whistle — anything. The loom listens and weaves what it hears:
                        every frequency in your sound becomes a thread of light, <em>low</em> notes
                        glowing red near the bottom, <em>high</em> notes violet at the top, and the
                        whole fabric scrolls on as time passes.
                      </p>
                      <p className={styles.introText}>
                        The faint lines mark <em>semitones</em>. Try a slow siren from your lowest
                        note to your highest and watch the harmonics ripple above your voice — then
                        retune the rainbow&rsquo;s key colors below the loom to weave your own
                        palette.
                      </p>
                      <button type="button" className={styles.introBtn} onClick={dismissLoomIntro}>
                        Start the loom
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!showIntro && (
              <>
                <div className={styles.loomBar}>
                  <div className={styles.loomGroup}>
                    <span className={styles.loomGroupLabel}>Pattern</span>
                    {PATTERNS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={
                          p.id === loomPattern ? styles.loomPatternBtnOn : styles.loomPatternBtn
                        }
                        disabled={!p.ready}
                        title={p.detail}
                        onClick={() => chooseLoomPattern(p.id)}
                      >
                        {p.label}
                        {!p.ready && <span className={styles.loomSoon}>soon</span>}
                      </button>
                    ))}
                  </div>
                  <div className={styles.loomGroup}>
                    <span className={styles.loomGroupLabel}>Rainbow</span>
                    {loomColors.map((c, i) => (
                      <input
                        key={i}
                        type="color"
                        className={styles.loomSwatch}
                        value={c}
                        aria-label={`Rainbow key color ${i + 1} of ${loomColors.length}`}
                        onChange={(e) => setLoomColor(i, e.target.value)}
                      />
                    ))}
                    <button
                      type="button"
                      className={styles.loomPatternBtn}
                      onClick={resetLoomColors}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className={styles.playFooter}>
                  <div className={styles.hint}>
                    Pitch runs {loomPattern === "ribbon" ? "bottom to top" : "left to right"} ·
                    faint lines mark semitones · brightness is each frequency&rsquo;s strength
                  </div>
                  <button type="button" className={styles.endBtn} onClick={leaveLoom}>
                    Leave the loom
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

function optStyle(selected: boolean): CSSProperties {
  return selected
    ? { background: "rgba(244,178,62,0.14)", borderColor: "#F4B23E" }
    : { background: "#16181f", borderColor: "#23262f" };
}

// "2 tufts of grass, a mushroom colony and a tree" — the visit recap's breakdown.
function recapBreakdown(counts: GardenRecap["counts"]): string {
  const names: [keyof GardenRecap["counts"], string, string][] = [
    ["mushroom", "mushroom colony", "mushroom colonies"],
    ["grass", "tuft of grass", "tufts of grass"],
    ["flower", "wildflower", "wildflowers"],
    ["tree", "tree", "trees"],
    ["butterfly", "butterfly", "butterflies"],
  ];
  const parts = names
    .filter(([k]) => counts[k] > 0)
    .map(([k, one, many]) => (counts[k] === 1 ? `a ${one}` : `${counts[k]} ${many}`));
  if (parts.length === 0) return "nothing yet";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// The Range Explorer verdict chart: all six voice ranges as horizontal bars on a
// shared MIDI axis, with the player's sung range overlaid as a band and the
// best-matching female (amber) and male (teal) voices highlighted.
function RangeChart({ result }: { result: RangeResult }) {
  const rows = [...VOICES].sort((a, b) => b.hi - a.hi); // highest voice on top
  const domainLo = Math.min(result.loMidi, ...VOICES.map((v) => v.lo)) - 1;
  const domainHi = Math.max(result.hiMidi, ...VOICES.map((v) => v.hi)) + 1;
  const VB_W = 720;
  const padL = 134;
  const padR = 18;
  const padT = 26; // headroom for the sung-range labels
  const rowH = 34;
  const plotBottom = padT + rows.length * rowH;
  const VB_H = plotBottom + 30;
  const xFor = (m: number) =>
    padL + ((m - domainLo) / (domainHi - domainLo)) * (VB_W - padL - padR);
  const sungL = xFor(result.loMidi);
  const sungR = xFor(result.hiMidi);
  const cLines: number[] = [];
  for (let m = Math.ceil(domainLo); m <= domainHi; m++) if (m % 12 === 0) cLines.push(m);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={styles.rangeChart}
      role="img"
      aria-label={`Your range ${result.loName} to ${result.hiName}, shown against the six voice types`}
    >
      {/* The sung range as a translucent band. */}
      <rect
        x={sungL}
        y={padT}
        width={Math.max(2, sungR - sungL)}
        height={plotBottom - padT}
        fill="rgba(255,255,255,0.07)"
      />

      {/* C-octave gridlines + labels. */}
      {cLines.map((m) => (
        <g key={`c${m}`}>
          <line
            x1={xFor(m)}
            y1={padT}
            x2={xFor(m)}
            y2={plotBottom}
            stroke="rgba(255,255,255,0.06)"
          />
          <text
            x={xFor(m)}
            y={plotBottom + 14}
            fill="#565c6a"
            fontSize="9"
            fontFamily={MONO}
            textAnchor="middle"
          >
            {midiName(m)}
          </text>
        </g>
      ))}

      {/* Sung-range dashed edges + note labels. */}
      {(
        [
          [sungL, result.loName],
          [sungR, result.hiName],
        ] as [number, string][]
      ).map(([x, name], i) => (
        <g key={`s${i}`}>
          <line
            x1={x}
            y1={padT - 4}
            x2={x}
            y2={plotBottom}
            stroke="#f3efe6"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.85"
          />
          <text
            x={x}
            y={padT - 10}
            fill="#f3efe6"
            fontSize="10"
            fontFamily={MONO}
            textAnchor="middle"
          >
            {name}
          </text>
        </g>
      ))}

      {/* One bar per voice; the matched female + male are highlighted. */}
      {rows.map((v, i) => {
        const cy = padT + i * rowH + rowH / 2;
        const isF = v.id === result.female.id;
        const isM = v.id === result.male.id;
        const on = isF || isM;
        const fill = isF
          ? "rgba(244,178,62,0.28)"
          : isM
            ? "rgba(53,196,181,0.24)"
            : "rgba(255,255,255,0.05)";
        const stroke = isF ? "#F4B23E" : isM ? "#35C4B5" : "#3a3f4a";
        return (
          <g key={v.id}>
            <text
              x={padL - 12}
              y={cy - 3}
              fill={on ? "#f3efe6" : "#8a90a0"}
              fontSize="12.5"
              fontFamily={SERIF}
              textAnchor="end"
            >
              {v.label}
            </text>
            <text
              x={padL - 12}
              y={cy + 10}
              fill={isF ? "#b9863a" : isM ? "#2f8f86" : "#565c6a"}
              fontSize="8.5"
              fontFamily={MONO}
              textAnchor="end"
            >
              {midiName(v.lo)}–{midiName(v.hi)}
            </text>
            <rect
              x={xFor(v.lo)}
              y={cy - 7}
              width={Math.max(2, xFor(v.hi) - xFor(v.lo))}
              height={14}
              rx="3"
              fill={fill}
              stroke={stroke}
              strokeWidth={on ? 1.5 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Stat({ n, l, accent }: { n: number; l: string; accent?: boolean }) {
  return (
    <div className={styles.stat}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 26,
          color: accent ? "#F4B23E" : "#f3efe6",
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#6b7180",
          marginTop: 2,
        }}
      >
        {l}
      </div>
    </div>
  );
}

// The home-screen pitch graph: the same visualization shown during play, drawn
// from the player's recent per-note cents stats. Redraws on data/size change.
function PitchGraph({
  notes,
  voiceId,
  level,
  height,
}: {
  notes: Record<string, NoteCents>;
  voiceId: VoiceId;
  level: LevelId;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = () => {
      const { lo, hi } = noteSet(voiceId, level);
      const bars: Record<number, GraphBar> = {};
      for (let m = lo; m <= hi; m++) {
        const ns = notes[String(m)];
        if (ns && ns.cN > 0) bars[m] = meanStd(ns.cN, ns.cSum, ns.cSqSum);
      }
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPitchGraph(ctx, {
        W: w,
        H: h,
        dLow: lo - 1.5,
        dHigh: hi + 1.5,
        lo,
        hi,
        bars,
        compact: true,
      });
    };
    render();
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [notes, voiceId, level, height]);
  return <canvas ref={ref} className={styles.homeGraphCanvas} style={{ height }} />;
}

// The "recent scores" chart: score (y) over how many days ago the session was
// (x), cut off at 90 days, scoped to the selected voice + level. Canvas-drawn so
// the axis labels stay crisp.
function RecentScoresChart({
  history,
  voiceId,
  level,
  height,
}: {
  history: SessionRecord[];
  voiceId: VoiceId;
  level: LevelId;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRecentScores(ctx, w, h, recentScorePoints(history, voiceId, level, Date.now(), 90));
    };
    render();
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [history, voiceId, level, height]);
  return <canvas ref={ref} className={styles.homeGraphCanvas} style={{ height }} />;
}

function drawRecentScores(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pts: { daysAgo: number; score: number }[],
): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0c0d12";
  ctx.fillRect(0, 0, W, H);

  const mL = 34;
  const mR = 12;
  const mT = 10;
  const mB = 30;
  const x0 = mL;
  const x1 = W - mR;
  const y0 = mT;
  const y1 = H - mB;

  const MAX_DAYS = 90;
  const maxScore = Math.max(10, ...pts.map((p) => p.score));
  // A round step sized for ~5 labels, whatever the score magnitude.
  const step = niceAxisStep(maxScore, 5);
  const yMax = Math.ceil(maxScore / step) * step;
  const xFor = (d: number) => x1 - (d / MAX_DAYS) * (x1 - x0); // 0 days = today (right)
  const yFor = (s: number) => y1 - (s / yMax) * (y1 - y0);

  ctx.font = "9px 'Spline Sans Mono', monospace";
  ctx.textBaseline = "middle";

  // Y grid + score labels.
  ctx.textAlign = "right";
  for (let s = 0; s <= yMax; s += step) {
    const y = yFor(s);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillStyle = "#565c6a";
    ctx.fillText(String(s), x0 - 5, y);
  }

  // X ticks + "days ago" labels.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#565c6a";
  for (const d of [0, 30, 60, 90]) {
    ctx.fillText(String(d), xFor(d), y1 + 6);
  }
  ctx.fillStyle = "#6b7180";
  ctx.fillText("Days Ago", (x0 + x1) / 2, y1 + 17);

  // Score line + dots (points come sorted oldest → newest).
  if (pts.length) {
    ctx.strokeStyle = "#35C4B5";
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xFor(p.daysAgo);
      const y = yFor(p.score);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#35C4B5";
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(xFor(p.daysAgo), yFor(p.score), 2.4, 0, 7);
      ctx.fill();
    }
  }
}
