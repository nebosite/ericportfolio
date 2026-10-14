import type { HostStats } from "./GameHost";
import { formatStat } from "./stats/StatTracker";
import styles from "./BlastCorpsPage.module.css";

// The hardware-probe readout under the main view: every metric as
// current / low / high since the last reset, plus what the machine is.
// Everything here is simulated and measured live — nothing is animated.

const INTEGER_ROWS = new Set([
  "fps",
  "draw calls",
  "triangles",
  "bodies awake",
  "joints holding",
  "breaks / step",
]);

export default function StatsPanel({ stats, onReset }: { stats: HostStats; onReset: () => void }) {
  const threads = stats.threads > 0 ? `${stats.threads + 1} threads` : "1 thread";
  const isolation = stats.crossOriginIsolated
    ? "cross-origin isolated"
    : "not isolated — open this page directly (not via a link) for multithreading";
  return (
    <section className={styles.statsPanel} aria-label="Hardware probe">
      <div className={styles.statsHead}>
        <span className={styles.statsTitle}>Hardware probe</span>
        <span className={styles.statsMeta}>
          {stats.partCount.toLocaleString()} parts · {stats.jointCount.toLocaleString()} joints ·{" "}
          {threads} · {isolation}
        </span>
        <button type="button" className={styles.statsReset} onClick={onReset}>
          Reset hi/lo
        </button>
      </div>
      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th>metric</th>
            <th>now</th>
            <th>low</th>
            <th>high</th>
          </tr>
        </thead>
        <tbody>
          {stats.rows.map(({ name, sample }) => {
            const d = INTEGER_ROWS.has(name) ? 0 : 1;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{formatStat(round(sample.current, d), d)}</td>
                <td>{formatStat(round(sample.low, d), d)}</td>
                <td>{formatStat(round(sample.high, d), d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.statsFoot}>GPU: {stats.gpu}</div>
    </section>
  );
}

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
