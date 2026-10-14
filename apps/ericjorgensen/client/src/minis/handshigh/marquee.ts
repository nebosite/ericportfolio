/** Pure marquee math for Hands High — no DOM, so it is unit-testable. */

/** Characters per second: a little under comfortable reading speed for huge letters. */
export const DEFAULT_CHARS_PER_SECOND = 2.0;
export const MIN_CHARS_PER_SECOND = 0.5;
export const MAX_CHARS_PER_SECOND = 5;

/** Blank screen between the last letter leaving and the next loop entering. */
export const LOOP_PAUSE_MS = 2000;

/** Longest message accepted; keeps one loop short enough to be worth repeating. */
export const MAX_MESSAGE_LENGTH = 200;

/** Upper-case, collapse whitespace, and cap the length. Empty means "nothing to show". */
export function normalizeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase().slice(0, MAX_MESSAGE_LENGTH);
}

/** Pixels per second so the average character crosses the screen at `charsPerSecond`. */
export function scrollSpeed(textWidth: number, charCount: number, charsPerSecond: number): number {
  if (charCount <= 0) return 0;
  return (textWidth / charCount) * charsPerSecond;
}

/**
 * Left edge of the text at `elapsedMs`. The text enters from the right edge and exits
 * fully off the left edge; then the screen stays blank for `pauseMs` before the loop
 * restarts.
 */
export function marqueeOffset(
  elapsedMs: number,
  viewportWidth: number,
  textWidth: number,
  speed: number,
  pauseMs = LOOP_PAUSE_MS,
): number {
  const travel = viewportWidth + textWidth;
  if (speed <= 0 || travel <= 0) return viewportWidth;
  const travelMs = (travel / speed) * 1000;
  const t = elapsedMs % (travelMs + pauseMs);
  if (t >= travelMs) return -textWidth; // blank pause: fully off the left edge
  return viewportWidth - (t / 1000) * speed;
}

/** Font size that makes capital letters span `fraction` of the viewport height. */
export function fontSizeForHeight(viewportHeight: number, capHeightRatio = 0.72, fraction = 0.84) {
  return (viewportHeight * fraction) / capHeightRatio;
}

export type FontWidth = "wide" | "narrow";

/**
 * Typeface for the marquee. "Wide" is the heavy Arial Black look (plain Arial when bold is
 * off, since Arial Black has no light weight); "narrow" is Arial Narrow, falling back to
 * Roboto Condensed where that is the phone's condensed face.
 */
export function fontStyle(bold: boolean, font: FontWidth) {
  if (font === "narrow") {
    return {
      fontFamily: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
      fontStretch: "condensed",
      fontWeight: bold ? 700 : 400,
    };
  }
  return bold
    ? {
        fontFamily: '"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif',
        fontStretch: "normal",
        fontWeight: 900,
      }
    : {
        fontFamily: 'Arial, "Helvetica Neue", sans-serif',
        fontStretch: "normal",
        fontWeight: 400,
      };
}
