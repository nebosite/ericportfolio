import { useEffect, useRef, useState, CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  PitchcraftEngine,
  Hud,
  SessionResult,
  MicError,
  blankHud,
} from "./engine";
import {
  VOICES,
  LEVELS,
  VoiceId,
  noteSet,
  midiName,
  isSharp,
  NOTE_NAMES,
} from "./src/game/notes";
import {
  Stats,
  SessionRecord,
  DEFAULT_STATS,
  loadStats,
  saveStats,
  loadHistory,
  addHistory,
  applySession,
  submitHighScore,
  bestFor,
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

type Phase = "intro" | "playing" | "summary";
interface Summary {
  score: number;
  accuracy: number;
  vibratoSec: number;
  bestNote: string;
  isBest: boolean;
}

interface MapCell {
  midi: number;
  label: string;
  title: string;
  bg: string;
  fg: string;
  border: string;
}

function buildPitchMap(
  stats: Stats,
  voiceId: VoiceId,
  level: 1 | 2 | 3 | 4,
): MapCell[] {
  const { lo, hi } = noteSet(voiceId, level);
  const out: MapCell[] = [];
  for (let m = lo; m <= hi; m++) {
    const ns = stats.notes[String(m)];
    const mastery = ns && ns.n > 0 ? ns.rSum / ns.n : null;
    const sharp = isSharp(m);
    let bg = "#16181f";
    let fg = "#3a3f4a";
    let border = "#23262f";
    if (mastery != null) {
      const al = 0.14 + 0.82 * mastery;
      bg = `rgba(244,178,62,${al})`;
      fg = mastery > 0.45 ? "#0a0b0f" : "#8a90a0";
      border = `rgba(244,178,62,${al + 0.1})`;
    }
    out.push({
      midi: m,
      label: sharp ? "" : NOTE_NAMES[((m % 12) + 12) % 12],
      title:
        midiName(m) +
        (mastery != null ? ` · ${Math.round(mastery * 100)}%` : " · untried"),
      bg,
      fg,
      border,
    });
  }
  return out;
}

function sparkPoints(history: SessionRecord[]): string {
  const pts = history.slice(-14);
  if (pts.length < 2) return "";
  const max = Math.max(...pts.map((h) => h.score), 1);
  return pts
    .map((h, i) => {
      const x = (i / (pts.length - 1)) * 100;
      const y = 32 - (h.score / max) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

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
  const [level, setLevel] = useState<1 | 2 | 3 | 4>(1);
  const [stats, setStats] = useState<Stats>({ ...DEFAULT_STATS });
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [hud, setHud] = useState<Hud>(blankHud());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [micError, setMicError] = useState<MicError | null>(null);

  // Load saved stats/history and restore the last voice/level.
  useEffect(() => {
    let alive = true;
    Promise.all([loadStats(), loadHistory()]).then(([s, h]) => {
      if (!alive) return;
      statsRef.current = s;
      setStats(s);
      setHistory(h);
      if (s.prefs?.voiceId) setVoiceId(s.prefs.voiceId as VoiceId);
      if (s.prefs?.difficulty) setLevel(s.prefs.difficulty as 1 | 2 | 3 | 4);
    });
    return () => {
      alive = false;
      engineRef.current?.destroy();
    };
  }, []);

  const persistPrefs = (vid: VoiceId, lvl: 1 | 2 | 3 | 4) => {
    const w = statsRef.current;
    w.prefs = { voiceId: vid, difficulty: lvl };
    void saveStats(w);
  };
  const chooseVoice = (id: VoiceId) => {
    setVoiceId(id);
    persistPrefs(id, level);
  };
  const chooseLevel = (n: 1 | 2 | 3 | 4) => {
    setLevel(n);
    persistPrefs(voiceId, n);
  };

  const handleEnd = async (result: SessionResult) => {
    engineRef.current = null;
    const w = statsRef.current;
    const { isBest, date } = applySession(w, {
      score: result.score,
      perNote: result.perNote,
      voiceId,
      difficulty: level,
    });
    setStats({ ...w });
    await saveStats(w);
    const rec: SessionRecord = {
      ts: Date.now(),
      d: date,
      score: result.score,
      accuracy: result.accuracy,
      voice: voiceId,
      level,
    };
    await addHistory(rec);
    submitHighScore(rec);
    setHistory((h) => [...h, rec].slice(-200));
    setSummary({
      score: result.score,
      accuracy: result.accuracy,
      vibratoSec: result.vibratoSec,
      bestNote: result.bestNote,
      isBest,
    });
    setPhase("summary");
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
    setSummary(null);
    setHud(blankHud());
    setPhase("playing");
    // getUserMedia is invoked synchronously inside start(), preserving the click
    // gesture; the canvas mounts from the phase change and attaches via its ref.
    engine.start().catch((err: MicError) => {
      engine.destroy();
      engineRef.current = null;
      setPhase("intro");
      setMicError(err === "denied" ? "denied" : "error");
    });
  };

  const endSession = () => engineRef.current?.stop();

  const { lo, hi, set } = noteSet(voiceId, level);
  const planText =
    level === 4
      ? `LV 4 · 8 short tunes · 5 notes each · sing from memory, no guide tone`
      : `LV ${level} · ${midiName(lo)}–${midiName(hi)} · ${set.length} notes × 3 passes (up · down · shuffle)`;
  const mapRange = `${midiName(lo)}–${midiName(hi)}`;
  const pitchMap = buildPitchMap(stats, voiceId, level);
  const spark = sparkPoints(history);

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
            Hear the tone, then find it in your voice. A pitch-matching trainer
            that meets you in your range.
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
                        LV {lv.n}
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

              <button
                type="button"
                className={styles.startBtn}
                onClick={startSession}
              >
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
                Pitch map · {mapRange}
              </div>
              <PitchMap cells={pitchMap} />
              <div className={styles.legend}>
                <span>weak</span>
                <span className={styles.legendBar} />
                <span>strong</span>
              </div>

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
                  <svg
                    viewBox="0 0 100 34"
                    preserveAspectRatio="none"
                    className={styles.spark}
                  >
                    <polyline
                      points={spark}
                      fill="none"
                      stroke="#35C4B5"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </>
              )}
            </div>
          </div>
        )}

        {phase === "playing" && (
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

            <div className={styles.stage}>
              <canvas
                ref={(el) => engineRef.current?.setCanvas(el)}
                className={styles.canvas}
              />
              {hud.vibrato && (
                <div className={styles.vibBadge}>Vibrato ×10</div>
              )}
              <div className={styles.timer}>
                <div
                  className={styles.timerFill}
                  style={{
                    width: `${hud.timerPct}%`,
                    background: hud.targetColor,
                  }}
                />
              </div>
            </div>

            <div className={styles.playFooter}>
              <div className={styles.hint}>
                {level === 4
                  ? "Hear the tune, then sing it back from memory · no guide tone"
                  : "Listen 2s · ready 2s · then sing · ⅛ step ×5 · ¼ ×2 · semitone ×1"}
              </div>
              <button
                type="button"
                className={styles.endBtn}
                onClick={endSession}
              >
                Quit round
              </button>
            </div>
          </div>
        )}

        {phase === "summary" && summary && (
          <div className={styles.summaryGrid}>
            <div className={styles.card}>
              <div style={label}>Session complete</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 58,
                    lineHeight: 1,
                    color: "#F4B23E",
                  }}
                >
                  {summary.score}
                </div>
                {summary.isBest && (
                  <span className={styles.bestBadge}>New best</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 26, marginTop: 24 }}>
                <SumStat v={`${summary.accuracy}%`} l="accuracy" />
                <SumStat
                  v={
                    summary.vibratoSec > 0
                      ? `${summary.vibratoSec.toFixed(1)}s`
                      : "0s"
                  }
                  l="vibrato held"
                  color="#35C4B5"
                />
                <SumStat v={summary.bestNote} l="strongest note" serif />
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={startSession}
                >
                  Practice again
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => setPhase("intro")}
                >
                  Change range
                </button>
              </div>
            </div>

            <div className={styles.cardFlat}>
              <div style={label}>Pitch map · {mapRange}</div>
              <div style={{ marginTop: 16 }}>
                <PitchMap cells={pitchMap} />
              </div>
              <div className={styles.statsRow} style={{ marginTop: 22 }}>
                <Stat n={stats.streak} l="day streak" />
                <Stat n={stats.sessions} l="sessions" />
                <Stat n={bestFor(stats, voiceId, level)} l="best" accent />
              </div>
            </div>
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

function SumStat({
  v,
  l,
  color,
  serif,
}: {
  v: string;
  l: string;
  color?: string;
  serif?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: serif ? SERIF : MONO,
          fontSize: 24,
          color: color ?? "#f3efe6",
        }}
      >
        {v}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#6b7180",
          marginTop: 3,
        }}
      >
        {l}
      </div>
    </div>
  );
}

function PitchMap({ cells }: { cells: MapCell[] }) {
  return (
    <div className={styles.map}>
      {cells.map((c) => (
        <div
          key={c.midi}
          title={c.title}
          className={styles.cell}
          style={{ background: c.bg, borderColor: c.border, color: c.fg }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}
