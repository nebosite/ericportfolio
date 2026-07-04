import { useEffect, useRef, useState, CSSProperties } from "react";
import { Link } from "react-router-dom";
import FeedbackPanel from "../../components/FeedbackPanel";
import { PitchcraftEngine, Hud, SessionResult, MicError, blankHud } from "./engine";
import { VOICES, LEVELS, VoiceId, LevelId, noteSet, midiName } from "./src/game/notes";
import { drawPitchGraph, meanStd, niceAxisStep, GraphBar } from "./src/game/pitchGraph";
import {
  Stats,
  SessionRecord,
  NoteCents,
  DEFAULT_STATS,
  loadStats,
  saveStats,
  loadHistory,
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

type Phase = "intro" | "playing" | "done";

const label: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#6b7180",
};

export default function PitchcraftPage() {
  const engineRef = useRef<PitchcraftEngine | null>(null);
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
  const [showIntro, setShowIntro] = useState(false);

  // Load saved stats/history and restore the last voice/level.
  useEffect(() => {
    let alive = true;
    Promise.all([loadStats(), loadHistory()]).then(([s, h]) => {
      if (!alive) return;
      statsRef.current = s;
      setStats(s);
      setHistory(h);
      if (s.prefs?.voiceId) setVoiceId(s.prefs.voiceId as VoiceId);
      if (s.prefs?.difficulty) setLevel(s.prefs.difficulty as LevelId);
    });
    return () => {
      alive = false;
      engineRef.current?.destroy();
    };
  }, []);

  // Browser Back during a round: a press while playing quits it (→ the "done"
  // recap), and a press on the recap returns home. A guard history entry is
  // pushed on entry and re-armed after quitting, so Back keeps being caught until
  // we reach home. phaseRef lets the (dep-stable) listener read the live phase.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const inRound = phase === "playing" || phase === "done";
  useEffect(() => {
    if (!inRound) return;
    window.history.pushState({ pitchcraft: true }, "");
    const onPop = () => {
      if (phaseRef.current === "playing") {
        engineRef.current?.stop(); // quit → "done" recap
        window.history.pushState({ pitchcraft: true }, ""); // re-arm for the next Back
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

  // Leave the finished level and go back to the home screen.
  const returnHome = () => {
    engineRef.current?.destroy();
    engineRef.current = null;
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

  const { lo, hi, set } = noteSet(voiceId, level);
  const planText =
    level === 0
      ? `Training · ${midiName(lo)}–${midiName(hi)} · 5 notes · up then down, guided`
      : level === 4
        ? `LV 4 · 8 short tunes · 5 notes each · sing from memory, no guide tone`
        : `LV ${level} · ${midiName(lo)}–${midiName(hi)} · ${set.length} notes × 3 passes (up · down · shuffle)`;
  const mapRange = `${midiName(lo)}–${midiName(hi)}`;
  // Home pitch graph: the most recent 10 sessions for the selected voice.
  const recentNotes = recentNoteStats(history, voiceId, 10);

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
                      It helps to be somewhere <em>quiet</em>, and to sing out with your full voice —
                      the way you&rsquo;d call a friend&rsquo;s name from across the street. Don&rsquo;t
                      hold back.
                    </p>
                    <p className={styles.introText}>
                      You&rsquo;ll hear a tone. When the colored bar crosses the play line, match it
                      by singing <em>&ldquo;ooo,&rdquo; &ldquo;ooh,&rdquo;</em> or{" "}
                      <em>&ldquo;aah&rdquo;</em> — loudly. A wiggly line traces your actual pitch, and
                      you earn more points the more of it you keep inside the bar.
                    </p>
                    <p className={styles.introText}>
                      Keep trying. Even practiced singers struggle with pitch, and you&rsquo;ll get
                      better over time. Challenge yourself to sing every day for two weeks and watch
                      your score change.
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
                        Nice work. Look at the graph on the right <span className={styles.arrow}>→</span>{" "}
                        to see how <em>flat</em> or <em>sharp</em> you landed on each note, and how
                        steady your pitch was — the wider the bar, the more it wandered.
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
                  {level === 4
                    ? "Hear the tune, then sing it back from memory · no guide tone"
                    : "Listen 2s · ready 2s · then sing · ⅛ step ×5 · ¼ ×2 · semitone ×1"}
                </div>
                <button type="button" className={styles.endBtn} onClick={endSession}>
                  Quit round
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function optStyle(selected: boolean): CSSProperties {
  return selected
    ? { background: "rgba(244,178,62,0.14)", borderColor: "#F4B23E" }
    : { background: "#16181f", borderColor: "#23262f" };
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
      drawPitchGraph(ctx, { W: w, H: h, dLow: lo - 1.5, dHigh: hi + 1.5, lo, hi, bars, compact: true });
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
