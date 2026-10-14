import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import FeedbackPanel from "../../components/FeedbackPanel";
import SiteFooter from "../../components/SiteFooter";
import { trackEvent } from "../../lib/analytics";
import { useEngagement } from "../../lib/engagement";
import { recordPlay } from "../../lib/plays";
import { GameHost, type HostStats } from "./GameHost";
import type { InputAction } from "./input/KeyboardSource";
import { PAD_BUTTON } from "./input/controls";
import { BUILDING_SIZES, SIZE_SPECS, planBuilding, type BuildingSize } from "./sim/buildingPlan";
import type { FloorsPolicy, SceneSpec } from "./sim/protocol";
import { SLAB_STORY_LIMIT, estimateStreetParts } from "./sim/street";
import StatsPanel from "./StatsPanel";
import styles from "./BlastCorpsPage.module.css";

// Blast Corps Reimagined — drive a 900-tonne machine down a street of
// skyscrapers whose every column, beam, slab and glass unit is a rigid body
// held by connections that fail when the solver says they must. This file is
// the React shell: title screen, HUD, restart flow, the hardware-probe panel
// and analytics. The game itself is GameHost (main thread) + the physics worker.

export const ENTITY = "blast-corps-reimagined";
/** Per-tower demolition (by mass) at which a tower counts as felled. */
export const TOWER_FELLED = 0.5;
/** Driving this far past the last tower ends the run with a card. */
export const END_OF_STREET_MARGIN = 80;

const SIZE_LABEL: Record<BuildingSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  colossal: "Colossal",
};
const TOWER_COUNTS = [2, 4, 6, 8, 10];
const STORY_MAXES = [10, 20, 30, 40, 50];
const FLOORS: { id: FloorsPolicy; label: string }[] = [
  { id: "auto", label: `up to ${SLAB_STORY_LIMIT} stories` },
  { id: "none", label: "none" },
  { id: "all", label: "all (unstable above 12)" },
];

type Phase = "title" | "playing";
type StreetSpec = Extract<SceneSpec, { kind: "street" }>;

export default function BlastCorpsPage() {
  useEngagement(ENTITY);

  const [phase, setPhase] = useState<Phase>("title");
  const [street, setStreet] = useState<StreetSpec>({
    kind: "street",
    towers: 10,
    maxStories: 30,
    glass: true,
    floors: "auto",
  });
  const [classic, setClassic] = useState<BuildingSize | null>(null);
  const scene: SceneSpec = classic ? { kind: "tower", size: classic } : street;
  const [stats, setStats] = useState<HostStats | null>(null);
  const [showStats, setShowStats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [felled, setFelled] = useState<{ index: number; mass: number; at: number } | null>(null);
  const felledSeen = useRef<Set<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<GameHost | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const classicCounts = useMemo(
    () =>
      Object.fromEntries(BUILDING_SIZES.map((s) => [s, planBuilding(s).parts.length])) as Record<
        BuildingSize,
        number
      >,
    [],
  );
  const partEstimate = classic ? classicCounts[classic] : estimateStreetParts(street);

  const clearRun = () => {
    setStartedAt(null);
    setEndedAt(null);
    setFelled(null);
    felledSeen.current = new Set();
  };

  const start = () => {
    recordPlay(ENTITY);
    trackEvent("game_start", {
      game: ENTITY,
      scene: scene.kind,
      towers: scene.kind === "street" ? scene.towers : 1,
      stories: scene.kind === "street" ? scene.maxStories : 0,
      parts: partEstimate,
    });
    setStats(null);
    setError(null);
    clearRun();
    setPhase("playing");
  };

  const quit = () => {
    setPhase("title");
    setStats(null);
  };

  const restart = () => {
    hostRef.current?.reset(sceneRef.current);
    hostRef.current?.resetStats();
    clearRun();
    trackEvent("game_restart", { game: ENTITY, scene: sceneRef.current.kind });
  };

  // Mount the game while playing; tear it down on leave.
  useEffect(() => {
    if (phase !== "playing" || !canvasRef.current) return;
    const host = new GameHost(canvasRef.current, sceneRef.current, {
      onStats: setStats,
      onAction: (action: InputAction) => {
        if (action === "reset") restart();
        else if (action === "quit") quit();
        else setShowStats((s) => !s);
      },
      onError: (message) => setError(message),
    });
    hostRef.current = host;
    host.start();
    return () => {
      host.destroy();
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The clock starts on the first throttle input, not on Start.
  useEffect(() => {
    if (stats?.throttleSeen && startedAt === null) setStartedAt(Date.now());
  }, [stats?.throttleSeen, startedAt]);

  // The run ends when every tower is felled, or when the machine drives off the
  // end of the street; either freezes the clock and shows the card.
  const felledCount = stats ? stats.structureDemolition.filter((f) => f >= TOWER_FELLED).length : 0;
  const allFelled =
    stats !== null &&
    stats.ready &&
    stats.structures.length > 0 &&
    felledCount === stats.structures.length;
  const offTheEnd =
    stats !== null &&
    stats.ready &&
    stats.streetLength > 0 &&
    stats.vehicleZ > stats.streetLength + END_OF_STREET_MARGIN;
  const ended = allFelled || offTheEnd;
  useEffect(() => {
    if (!ended || endedAt !== null || stats === null) return;
    const at = Date.now();
    setEndedAt(at);
    trackEvent("game_over", {
      game: ENTITY,
      scene: scene.kind,
      felled: felledCount,
      towers: stats.structures.length,
      score: Math.round(stats.demolition * 100),
      seconds: startedAt === null ? 0 : Math.round((at - startedAt) / 1000),
    });
  }, [ended, endedAt, stats, scene.kind, startedAt, felledCount]);

  // Per-tower banner the first time each tower passes the felled threshold.
  useEffect(() => {
    if (!stats) return;
    stats.structureDemolition.forEach((fraction, index) => {
      if (fraction >= TOWER_FELLED && !felledSeen.current.has(index)) {
        felledSeen.current.add(index);
        setFelled({ index, mass: stats.structures[index]?.mass ?? 0, at: Date.now() });
        trackEvent("tower_felled", { game: ENTITY, tower: index });
      }
    });
  }, [stats]);

  // Tick the displayed clock while a run is live (also expires the felled banner).
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [phase]);

  // Title screen: Enter / Space on the keyboard or A / Start on a pad begins.
  useEffect(() => {
    if (phase !== "title") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    const poll = setInterval(() => {
      if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
      for (const pad of navigator.getGamepads()) {
        if (pad?.buttons[PAD_BUTTON.a]?.pressed || pad?.buttons[PAD_BUTTON.start]?.pressed) start();
      }
    }, 100);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scene]);

  const elapsedMs = startedAt === null ? 0 : Math.max(0, (endedAt ?? now) - startedAt);
  const felledTonnes = stats
    ? stats.structureDemolition.reduce(
        (t, f, i) => t + (f >= TOWER_FELLED ? (stats.structures[i]?.mass ?? 0) : 0),
        0,
      ) / 1000
    : 0;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <Link to="/" className={styles.back}>
            ← Field Guide
          </Link>
          <div className={styles.badge}>
            <span className={styles.badgeStripe} />
            <span>Pure AI Output</span>
          </div>
        </div>

        {phase === "title" && (
          <TitleScreen
            street={street}
            onStreet={setStreet}
            classic={classic}
            onClassic={setClassic}
            classicCounts={classicCounts}
            partEstimate={partEstimate}
            onStart={start}
          />
        )}

        {phase === "playing" && (
          <>
            <div className={styles.arena}>
              <canvas ref={canvasRef} className={styles.canvas} aria-label="Demolition arena" />
              <Hud
                stats={stats}
                elapsedMs={elapsedMs}
                ended={ended}
                allFelled={allFelled}
                felledCount={felledCount}
                felledTonnes={felledTonnes}
                felled={felled && now - felled.at < 2500 ? felled : null}
                error={error}
                onRestart={restart}
                onQuit={quit}
              />
            </div>
            {showStats && stats && (
              <StatsPanel stats={stats} onReset={() => hostRef.current?.resetStats()} />
            )}
          </>
        )}
      </div>
      {phase === "title" && <SiteFooter />}
    </div>
  );
}

/* ---- Title screen ------------------------------------------------------------ */

function TitleScreen({
  street,
  onStreet,
  classic,
  onClassic,
  classicCounts,
  partEstimate,
  onStart,
}: {
  street: StreetSpec;
  onStreet: (s: StreetSpec) => void;
  classic: BuildingSize | null;
  onClassic: (s: BuildingSize | null) => void;
  classicCounts: Record<BuildingSize, number>;
  partEstimate: number;
  onStart: () => void;
}) {
  const pickStreet = (patch: Partial<StreetSpec>) => {
    onClassic(null);
    onStreet({ ...street, ...patch });
  };
  const dial = <T extends string | number>(
    label: string,
    options: { value: T; label: string }[],
    current: T,
    pick: (v: T) => void,
  ) => (
    <div className={styles.dialRow}>
      <span className={styles.dialLabel}>{label}</span>
      <div className={styles.dial} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={!classic && current === o.value}
            className={`${styles.dialButton} ${!classic && current === o.value ? styles.sizeOn : ""}`}
            onClick={() => pick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className={styles.title}>
      <div className={styles.hazard} aria-hidden="true" />
      <h1 className={styles.titleName}>
        Blast Corps <span className={styles.titleRe}>Reimagined</span>
      </h1>
      <p className={styles.tagline}>
        Drive a 900-tonne machine down a street of skyscrapers built from{" "}
        <strong data-testid="part-estimate">{partEstimate.toLocaleString()} parts</strong> — every
        column, beam, slab and pane a real rigid body, held by connections that fail only when the
        physics says they must. Nothing about the collapse is scripted.
      </p>

      <button type="button" className={styles.startButton} onClick={onStart}>
        Start Demolition
      </button>
      <p className={styles.startHint}>Enter · Space · or press A on a controller</p>

      <div className={styles.controlsGrid}>
        <section className={styles.controlsCard}>
          <h2 className={styles.controlsTitle}>Keyboard</h2>
          <dl className={styles.keys}>
            <dt>W / ↑</dt>
            <dd>Throttle</dd>
            <dt>S / ↓</dt>
            <dd>Brake, then reverse</dd>
            <dt>A D / ← →</dt>
            <dd>Steer</dd>
            <dt>Space</dt>
            <dd>Handbrake</dd>
            <dt>Shift (hold)</dt>
            <dd>Slow motion — the physics keeps stepping</dd>
            <dt>R</dt>
            <dd>Rebuild the street</dd>
            <dt>F3</dt>
            <dd>Hide / show the hardware probe</dd>
            <dt>Esc</dt>
            <dd>Back to this screen</dd>
          </dl>
        </section>
        <section className={styles.controlsCard}>
          <h2 className={styles.controlsTitle}>Controller</h2>
          <dl className={styles.keys}>
            <dt>RT</dt>
            <dd>Throttle</dd>
            <dt>LT</dt>
            <dd>Brake, then reverse</dd>
            <dt>Left stick</dt>
            <dd>Steer</dd>
            <dt>A</dt>
            <dd>Handbrake</dd>
            <dt>LB (hold)</dt>
            <dd>Slow motion</dd>
            <dt>Start</dt>
            <dd>Rebuild the street</dd>
            <dt>Back</dt>
            <dd>Hide / show the hardware probe</dd>
            <dt>B</dt>
            <dd>Back to this screen</dd>
          </dl>
        </section>
      </div>

      <details className={styles.tuning} open>
        <summary>Scene</summary>
        <div className={styles.sizeHead}>Street</div>
        {dial(
          "Towers",
          TOWER_COUNTS.map((n) => ({ value: n, label: `${n} towers` })),
          street.towers,
          (towers) => pickStreet({ towers }),
        )}
        {dial(
          "Tallest",
          STORY_MAXES.map((n) => ({ value: n, label: `${n} stories` })),
          street.maxStories,
          (maxStories) => pickStreet({ maxStories }),
        )}
        {dial(
          "Floors",
          FLOORS.map((f) => ({ value: f.id, label: f.label })),
          street.floors ?? "auto",
          (floors) => pickStreet({ floors }),
        )}
        <div className={styles.dialRow}>
          <span className={styles.dialLabel}>Glass skin</span>
          <button
            type="button"
            role="switch"
            aria-checked={street.glass}
            aria-label="Glass skin"
            className={`${styles.dialButton} ${street.glass ? styles.sizeOn : ""}`}
            onClick={() => pickStreet({ glass: !street.glass })}
          >
            {street.glass ? "on" : "off"}
          </button>
        </div>
        <div className={styles.sizeHead}>Or the classic masonry tower</div>
        <div className={styles.sizeRow} role="radiogroup" aria-label="Classic tower size">
          {BUILDING_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={classic === s}
              className={`${styles.sizeButton} ${classic === s ? styles.sizeOn : ""}`}
              onClick={() => onClassic(classic === s ? null : s)}
            >
              <span className={styles.sizeName}>{SIZE_LABEL[s]}</span>
              <span className={styles.sizeMeta}>
                {classicCounts[s].toLocaleString()} parts · {SIZE_SPECS[s].courses} courses
              </span>
            </button>
          ))}
        </div>
        <p className={styles.tuningNote}>
          This build probes what your hardware can simulate: the panel under the arena shows physics
          time, bodies awake, triangles and memory with lows and highs. The street builds in while
          you drive, nearest tower first. Floors are the heaviest parts; the solver holds them on
          towers up to {SLAB_STORY_LIMIT} stories — set Floors to “all” to watch it fail.
        </p>
      </details>

      <details className={styles.tuning}>
        <summary>Under the hood</summary>
        <ul className={styles.hoodList}>
          <li>
            Jolt Physics (WebAssembly) in a Web Worker — multithreaded across your cores when the
            page is cross-origin isolated. Every part is a dynamic rigid body; every connection a
            six-axis constraint.
          </li>
          <li>
            Each step the solver reports the force every joint carried. Connections are rated in
            physical units — welded column splices, beam moment connections, silicone glass bites,
            masonry mortar — and fail in tension, shear, bending or (splices) crushing. Floor slabs
            rest on their beams.
          </li>
          <li>
            Real sections and masses: HSS columns (1.5 t per story), W21×62 beams (490 kg), 150 mm
            composite slabs (11 t), 12 mm glass units; a 900 t machine with Jolt's wheeled vehicle
            controller.
          </li>
          <li>
            Rendering: three.js, one instanced draw call for every part, posed on the GPU from the
            physics snapshot; particles integrated on the GPU; sound synthesised live.
          </li>
        </ul>
      </details>

      <FeedbackPanel entity={ENTITY} />
    </div>
  );
}

/* ---- HUD ------------------------------------------------------------------------ */

function Hud({
  stats,
  elapsedMs,
  ended,
  allFelled,
  felledCount,
  felledTonnes,
  felled,
  error,
  onRestart,
  onQuit,
}: {
  stats: HostStats | null;
  elapsedMs: number;
  ended: boolean;
  allFelled: boolean;
  felledCount: number;
  felledTonnes: number;
  felled: { index: number; mass: number } | null;
  error: string | null;
  onRestart: () => void;
  onQuit: () => void;
}) {
  const percent = stats ? Math.round(stats.demolition * 100) : 0;
  const ready = stats?.ready ?? false;
  const building = stats !== null && stats.ready && stats.built < stats.totalStructures;
  const pad = stats?.padConnected ?? false;
  const towers = stats?.structures.length ?? 0;
  return (
    <div className={styles.hud}>
      <div className={styles.hudTop}>
        <div className={styles.meter} aria-label="Demolition">
          <div className={styles.meterLabel}>
            Towers felled {felledCount} / {towers} · {percent}% of the street by tonnage
          </div>
          <div className={styles.meterValue} data-testid="demolition">
            {Math.round(felledTonnes).toLocaleString()} t
          </div>
          <div className={styles.segments} data-testid="segments">
            {(stats?.structureDemolition ?? []).map((f, i) => (
              <div key={i} className={styles.segment}>
                <div
                  className={`${styles.segmentFill} ${f >= TOWER_FELLED ? styles.segmentFelled : ""}`}
                  style={{ width: `${Math.round(Math.min(1, f) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className={styles.clockColumn}>
          <div className={styles.clock} data-testid="clock">
            {formatClock(elapsedMs)}
          </div>
          {stats && stats.timeScale < 1 && <div className={styles.slowBadge}>SLOW MOTION</div>}
        </div>
      </div>

      {!ready && !error && <div className={styles.notice}>Laying out the street…</div>}
      {building && (
        <div className={styles.noticeSmall} data-testid="building">
          Building tower {stats.built + 1} of {stats.totalStructures}…
        </div>
      )}
      {error && <div className={`${styles.notice} ${styles.noticeError}`}>{error}</div>}
      {stats?.flipped && ready && (
        <div className={styles.notice}>Flipped — righting the machine</div>
      )}

      {felled && !ended && (
        <div className={styles.felled} role="status">
          Tower {felled.index + 1} felled — {Math.round(felled.mass / 1000).toLocaleString()} t
        </div>
      )}

      {ended && (
        <div className={styles.banner} role="status">
          <div className={styles.bannerTitle}>
            {allFelled ? "Street Leveled!" : "End of the street"}
          </div>
          <div className={styles.bannerLine}>
            {felledCount} of {towers} towers · {Math.round(felledTonnes).toLocaleString()} t ·{" "}
            {formatClock(elapsedMs)} — {pad ? "Start" : "R"} to go again
          </div>
          <div className={styles.bannerButtons}>
            <button type="button" className={styles.hudButton} onClick={onRestart}>
              Go Again
            </button>
            <button
              type="button"
              className={`${styles.hudButton} ${styles.hudButtonQuiet}`}
              onClick={onQuit}
            >
              Title
            </button>
          </div>
        </div>
      )}

      <div className={styles.hint}>
        {pad
          ? "RT throttle · LT brake · stick steer · A handbrake · LB slow-mo · Start rebuild · B title"
          : "W throttle · S brake · A D steer · Space handbrake · Shift slow-mo · R rebuild · Esc title"}
      </div>
    </div>
  );
}

export function formatClock(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${tenths % 10}`;
}
