import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BigPacEngine, StartOpts } from "./engine";
import FeedbackPanel from "../../components/FeedbackPanel";
import VolumeControl from "../../components/VolumeControl";
import { trackEvent } from "../../lib/analytics";
import { recordPlay } from "../../lib/plays";
import { useEngagement } from "../../lib/engagement";
import styles from "./BigPacTinyMan.module.css";

const GAME = "big-pac-tiny-man";
const START_HP = 5;

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

export default function BigPacTinyManPage() {
  useEngagement("big-pac-tiny-man");
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BigPacEngine | null>(null);
  const [score, setScore] = useState(0);
  const [hitpoints, setHitpoints] = useState(START_HP);
  const [maxHitpoints, setMaxHitpoints] = useState(START_HP);
  const [level, setLevel] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [levelingUp, setLevelingUp] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [initials, setInitials] = useState("");
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);
  const [worldKey, setWorldKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);

  // Live refs so the engine callbacks / timeouts never read stale state.
  const scoreRef = useRef(0);
  const hpRef = useRef(START_HP);
  const levelRef = useRef(1);
  // The run state carried into the next world build (level up, or a fresh game).
  const startOptsRef = useRef<StartOpts>({ level: 1, score: 0, hitpoints: START_HP });
  const autoStartRef = useRef(false);
  const levelTimerRef = useRef<number | undefined>(undefined);

  const loadLeaderboard = () => {
    fetch(`/api/leaderboard?game=${GAME}`)
      .then((res) => res.json())
      .then((data: ScoreRow[]) => setLeaderboard(data))
      .catch(() => {});
  };
  useEffect(loadLeaderboard, []);
  useEffect(() => () => window.clearTimeout(levelTimerRef.current), []);

  // The maze derives from the page size, so a resize means a new world — but
  // only until play begins. Once the player has started, the world is locked
  // in and resizing just letterboxes the existing canvas.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (engineRef.current?.hasStarted) return;
        setStarted(false);
        setReady(false);
        setWorldKey((k) => k + 1);
      }, 400);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: BigPacEngine | null = null;
    let disposed = false;
    setReady(false);
    setGameOver(false);
    BigPacEngine.create(
      host,
      (s) => {
        scoreRef.current = s;
        setScore(s);
      },
      (hp, max) => {
        hpRef.current = hp;
        setHitpoints(hp);
        setMaxHitpoints(max);
      },
      () => {
        setGameOver(true);
        trackEvent("game_over", { game: GAME, level: levelRef.current });
      },
      (completed) => {
        // Level cleared: announce the next level, then rebuild the world at it.
        const next = completed + 1;
        levelRef.current = next;
        setLevel(next);
        setLevelingUp(true);
        trackEvent("level_up", { game: GAME, level: next });
        levelTimerRef.current = window.setTimeout(() => {
          startOptsRef.current = { level: next, score: scoreRef.current, hitpoints: hpRef.current };
          autoStartRef.current = true;
          setWorldKey((k) => k + 1);
        }, 2200);
      },
      startOptsRef.current,
    ).then((e) => {
      if (disposed) {
        e.destroy();
        return;
      }
      engine = e;
      engineRef.current = e;
      setReady(true);
      if (autoStartRef.current) {
        autoStartRef.current = false;
        e.start();
        setStarted(true);
        setLevelingUp(false);
      }
    });
    return () => {
      disposed = true;
      engineRef.current = null;
      engine?.destroy();
    };
  }, [worldKey]);

  const handleStart = () => {
    const engine = engineRef.current;
    if (!engine) return;
    trackEvent("game_start", { game: GAME });
    recordPlay(GAME);
    engine.start();
    setStarted(true);
  };

  // After game over, rebuild a fresh level-1 world and return to the start gate.
  const handleRestart = () => {
    scoreRef.current = 0;
    hpRef.current = START_HP;
    levelRef.current = 1;
    startOptsRef.current = { level: 1, score: 0, hitpoints: START_HP };
    setScore(0);
    setLevel(1);
    setSubmitted(false);
    setInitials("");
    setGameOver(false);
    setStarted(false);
    setWorldKey((k) => k + 1);
  };

  const submitScore = async (e: FormEvent) => {
    e.preventDefault();
    const clean = initials.trim().toUpperCase();
    if (!clean) return;
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initials: clean, score: scoreRef.current, game: GAME }),
      });
      trackEvent("score_submitted", { game: GAME, score: scoreRef.current, initials: clean });
      loadLeaderboard();
    } finally {
      setSubmitted(true);
    }
  };

  const Leaderboard = () => (
    <ol className={styles.scoreList}>
      {leaderboard.map((row, i) => (
        <li key={row.id} className={styles.scoreRow}>
          <span className={styles.rank}>{(i + 1).toString().padStart(2, "0")}</span>
          <span className={styles.scoreInitials}>{row.initials}</span>
          <span className={styles.scoreValue}>{row.score.toLocaleString()}</span>
        </li>
      ))}
      {leaderboard.length === 0 && <li className={styles.scoreEmpty}>NO SCORES YET</li>}
    </ol>
  );

  return (
    <div className={styles.page}>
      {/* 50px bar above the game grid — everything HUD lives here. */}
      <div className={styles.topBar}>
        <Link to="/" className={styles.backLink}>
          ◀ LOBBY
        </Link>
        <h1 className={styles.title}>BIG PAC TINY MAN</h1>
        <p className={styles.level}>LVL {level}</p>
        <div className={styles.hearts} aria-label={`${hitpoints} of ${maxHitpoints} hearts`}>
          {Array.from({ length: maxHitpoints }, (_, i) => (
            <span key={i} className={i < hitpoints ? styles.heartFull : styles.heartEmpty}>
              {i < hitpoints ? "♥" : "♡"}
            </span>
          ))}
        </div>
        <p className={styles.score}>SCORE {score.toLocaleString()}</p>
      </div>
      <div className={styles.stageWrap}>
        <div ref={hostRef} key={worldKey} className={styles.stage} />

        {!started && !gameOver && (
          <div className={styles.titleScreen}>
            <h2 className={styles.titleHeading}>BIG PAC TINY MAN</h2>
            <FeedbackPanel entity={GAME} />
            <button
              type="button"
              className={styles.startButton}
              onClick={handleStart}
              disabled={!ready}
            >
              {ready ? "▶ START GAME" : "LOADING…"}
            </button>
            <p className={styles.titleHint}>
              Arrow keys / WASD / gamepad — or swipe &amp; tap on touch. Clear every dot to level
              up.
            </p>
            <VolumeControl />
          </div>
        )}

        {levelingUp && (
          <div className={`${styles.titleScreen} ${styles.levelUp}`}>
            <h2 className={styles.levelUpHeading}>LEVEL {level}</h2>
            <p className={styles.titleHint}>The ghosts hunt harder and faster…</p>
          </div>
        )}

        {gameOver && (
          <div className={styles.titleScreen}>
            <h2 className={styles.titleHeading}>GAME OVER</h2>
            <p className={styles.titleHint}>
              Final score {score.toLocaleString()} · reached level {level}
            </p>
            {!submitted ? (
              <>
                <form className={styles.initialsForm} onSubmit={submitScore}>
                  <label htmlFor="pac-initials">ENTER INITIALS:</label>
                  <input
                    id="pac-initials"
                    className={styles.initialsInput}
                    value={initials}
                    onChange={(e) =>
                      setInitials(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "")
                          .slice(0, 3),
                      )
                    }
                    maxLength={3}
                    autoFocus
                    required
                  />
                  <button type="submit" className={styles.startButton}>
                    SAVE
                  </button>
                </form>
                <button
                  type="button"
                  className={styles.skipButton}
                  onClick={() => setSubmitted(true)}
                >
                  skip
                </button>
              </>
            ) : (
              <button type="button" className={styles.startButton} onClick={handleRestart}>
                ▶ PLAY AGAIN
              </button>
            )}
            <Leaderboard />
          </div>
        )}
      </div>
    </div>
  );
}
