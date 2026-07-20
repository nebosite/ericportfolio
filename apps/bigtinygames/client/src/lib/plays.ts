// Per-game play tracking (localStorage) that schedules a one-time feature-request
// nudge on the 3rd and 10th play of a game. Framework-free so it's unit-tested.
//
// recordPlay(entity) is called when a game starts. takePendingNudge(entity) is
// called by the FeedbackPanel (on the title screen the player returns to) to
// decide whether to pop the "got any ideas?" dialog — and clears it so it fires
// exactly once per milestone. Kept in sync across the client apps.

export const NUDGE_MILESTONES = [3, 10] as const;

const playsKey = (entity: string) => `plays_${entity}`;
const nudgeKey = (entity: string) => `nudge_pending_${entity}`;

/** Increment and return this browser's play count for a game; arm a nudge at milestones. */
export function recordPlay(entity: string): number {
  let count = 1;
  try {
    count = (Number(localStorage.getItem(playsKey(entity))) || 0) + 1;
    localStorage.setItem(playsKey(entity), String(count));
    if ((NUDGE_MILESTONES as readonly number[]).includes(count)) {
      localStorage.setItem(nudgeKey(entity), String(count));
    }
  } catch {
    /* storage unavailable — play counting just won't persist */
  }
  return count;
}

/**
 * If a nudge is pending for this game, return the milestone that armed it
 * (3 or 10) and clear it so it never fires twice; otherwise null.
 */
export function takePendingNudge(entity: string): number | null {
  try {
    const raw = localStorage.getItem(nudgeKey(entity));
    if (!raw) return null;
    localStorage.removeItem(nudgeKey(entity));
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
