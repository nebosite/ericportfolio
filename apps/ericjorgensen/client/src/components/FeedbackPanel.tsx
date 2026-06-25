import { useEffect, useState, FormEvent } from "react";
import styles from "./FeedbackPanel.module.css";

// Standard per-entity feedback feature: two buttons that let visitors leave
// feedback (<=1000 chars) or vote on three random active items. Repeat votes
// are blocked per-browser via localStorage. `entity` is the game or app slug
// (e.g. "snake", "pixelwhimsy", "pitchcraft"). Kept in sync with the copies in
// the other client apps.

export const MAX_FEEDBACK = 1000;
const VOTED_KEY = "feedback_voted";

interface FeedbackItem {
  id: number;
  text: string;
  votes: number;
}

function readVoted(): Set<number> {
  try {
    const raw = localStorage.getItem(VOTED_KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function rememberVote(id: number): void {
  const set = readVoted();
  set.add(id);
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode / disabled storage — voting still works for this session */
  }
}

type Mode = "buttons" | "leave" | "vote";

export default function FeedbackPanel({ entity }: { entity: string }) {
  const [mode, setMode] = useState<Mode>("buttons");

  return (
    // Stop keystrokes from bubbling to window-level listeners, so typing
    // feedback never trips any page-level key handling.
    <div className={styles.panel} onKeyDown={(e) => e.stopPropagation()}>
      {mode === "buttons" && (
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.action}
            onClick={() => setMode("leave")}
          >
            Feature Request
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => setMode("vote")}
          >
            Vote on feature requests
          </button>
        </div>
      )}
      {mode === "leave" && (
        <LeaveForm entity={entity} onDone={() => setMode("buttons")} />
      )}
      {mode === "vote" && (
        <VoteList entity={entity} onDone={() => setMode("buttons")} />
      )}
    </div>
  );
}

function LeaveForm({
  entity,
  onDone,
}: {
  entity: string;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<
    "editing" | "submitting" | "done" | "error"
  >("editing");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, text: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div className={styles.notice}>
        <p>Thanks for the feedback!</p>
        <button type="button" className={styles.back} onClick={onDone}>
          Back
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="feedback-text" className={styles.label}>
        Your feedback
      </label>
      <textarea
        id="feedback-text"
        className={styles.textarea}
        maxLength={MAX_FEEDBACK}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell us what you think…"
      />
      <div className={styles.counter}>
        {text.length}/{MAX_FEEDBACK}
      </div>
      {status === "error" && (
        <p className={styles.error}>Could not send — please try again.</p>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.back} onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          className={styles.action}
          disabled={!text.trim() || status === "submitting"}
        >
          {status === "submitting" ? "Sending…" : "Submit"}
        </button>
      </div>
    </form>
  );
}

function VoteList({ entity, onDone }: { entity: string; onDone: () => void }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState(false);
  const [voted, setVoted] = useState<Set<number>>(() => readVoted());

  const load = () => {
    setItems(null);
    setError(false);
    fetch(`/api/feedback/random?entity=${encodeURIComponent(entity)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: FeedbackItem[]) => setItems(data))
      .catch(() => setError(true));
  };

  useEffect(load, [entity]);

  const upvote = async (item: FeedbackItem) => {
    if (voted.has(item.id)) return;
    try {
      const res = await fetch(`/api/feedback/${item.id}/vote`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { votes } = (await res.json()) as { votes: number };
      rememberVote(item.id);
      setVoted(readVoted());
      setItems((cur) =>
        cur ? cur.map((i) => (i.id === item.id ? { ...i, votes } : i)) : cur,
      );
    } catch {
      /* leave the item as-is; the visitor can try again */
    }
  };

  return (
    <div className={styles.vote}>
      {error && <p className={styles.error}>Could not load feedback.</p>}
      {!error && items === null && <p className={styles.muted}>Loading…</p>}
      {items && items.length === 0 && (
        <p className={styles.muted}>
          No feedback yet — be the first to leave some!
        </p>
      )}
      {items?.map((item) => {
        const hasVoted = voted.has(item.id);
        return (
          <div key={item.id} className={styles.voteItem}>
            <button
              type="button"
              className={styles.upvote}
              disabled={hasVoted}
              aria-label={
                hasVoted ? `Voted (${item.votes})` : `Upvote (${item.votes})`
              }
              onClick={() => upvote(item)}
            >
              ▲ {item.votes}
            </button>
            <span className={styles.voteText}>{item.text}</span>
          </div>
        );
      })}
      <div className={styles.row}>
        <button type="button" className={styles.back} onClick={onDone}>
          Back
        </button>
        {items && items.length > 0 && (
          <button type="button" className={styles.action} onClick={load}>
            Show 3 more
          </button>
        )}
      </div>
    </div>
  );
}
