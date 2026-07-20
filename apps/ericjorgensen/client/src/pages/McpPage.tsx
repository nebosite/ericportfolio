import { Link } from "react-router-dom";
import { trackEvent } from "../lib/analytics";
import styles from "./McpPage.module.css";

// A highlight of the Model Context Protocol servers I've built — what each does,
// how it's hosted, and a link to the code. MCP lets an AI agent reach past chat
// into real systems: data, operations, knowledge, even a native desktop app.

interface McpEntry {
  name: string;
  tag: string;
  accent: string;
  desc: string;
  code: string;
  codeLabel: string;
  live?: string;
  liveLabel?: string;
}

const ENTRIES: McpEntry[] = [
  {
    name: "Coding Mentor",
    tag: "Public · HTTP",
    accent: "#3A5A8C",
    desc: "A public MCP whose centerpiece is a prompt, not a tool: the Layered Development Coach interviews a developer and guides them one layer at a time instead of generating a whole app at once. Supporting tools return my project lessons and philosophy as structured data. It's the argument that an MCP can expose knowledge and workflow, not just an API.",
    live: "https://ericjorgensen.com/coach",
    liveLabel: "ericjorgensen.com/coach",
    code: "https://github.com/nebosite/ericportfolio/tree/main/apps/mentor/server",
    codeLabel: "Code →",
  },
  {
    name: "Feature-Request Insights",
    tag: "Private · HTTP",
    accent: "#2E6E6A",
    desc: "A bearer-gated, read-only MCP over my portfolio's feedback database — top requests per app, this-week activity, and duplicate detection — so an AI can answer product questions from live data instead of exported spreadsheets. Pure query functions do the work; the MCP layer just wraps them.",
    live: "https://ericjorgensen.com/mcp",
    liveLabel: "ericjorgensen.com/mcp (token-gated)",
    code: "https://github.com/nebosite/ericportfolio/tree/main/apps/insights/server",
    codeLabel: "Code →",
  },
  {
    name: "Portfolio DB",
    tag: "Local · stdio",
    accent: "#5E6B36",
    desc: "A read-only SQLite MCP over the feedback and leaderboard databases, wired straight into my editor so I can ask questions of real data — 'top scores per game', 'recent feedback' — without hand-writing SQL. Read-only by construction: it rejects anything that isn't a SELECT.",
    code: "https://github.com/nebosite/ericportfolio/blob/main/scripts/mcp/db-server.mjs",
    codeLabel: "Code →",
  },
  {
    name: "Portfolio Ops",
    tag: "Local · stdio",
    accent: "#5E6B36",
    desc: "An MCP that inspects the production VPS over SSH — service health across every app, PM2 status, and log tails — so pre- and post-deploy checks happen from inside a coding session instead of a separate terminal. It only runs read commands; it never deploys or restarts.",
    code: "https://github.com/nebosite/ericportfolio/blob/main/scripts/mcp/ops-server.mjs",
    codeLabel: "Code →",
  },
  {
    name: "Talisman QuickTimer",
    tag: "Desktop · .NET",
    accent: "#B5482E",
    desc: "An MCP built into Talisman, my Windows focus app for ADHD: the app hosts its own MCP server so an AI can set a quick timer through the tool itself. MCP reaching out of the browser and into a native desktop application.",
    code: "https://github.com/nebosite/talisman/blob/master/src/WindowsClient/Mcp/QuickTimerTool.cs",
    codeLabel: "Code →",
  },
];

export default function McpPage() {
  const out = (url: string, name: string) => trackEvent("outbound_link", { url, name });

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <Link to="/" className={styles.back}>
          ← A Field Guide to a Body of Work
        </Link>

        <p className={styles.kicker}>Model Context Protocol</p>
        <h1 className={styles.title}>Teaching agents to reach into real systems</h1>
        <p className={styles.intro}>
          MCP (the Model Context Protocol) is how an AI agent reaches past the chat window into
          actual systems — data, operations, knowledge, even a native desktop app. These are the
          MCP servers I've built. A few are private tools I use while coding; two run live on this
          site; one lives inside a Windows app. Each links to its source.
        </p>

        <div className={styles.rule} />

        <div className={styles.list}>
          {ENTRIES.map((e, i) => (
            <div key={e.name} className={styles.item}>
              <div className={styles.plate}>{String(i + 1).padStart(2, "0")}</div>
              <div>
                <div className={styles.itemHead}>
                  <h2 className={styles.name}>{e.name}</h2>
                  <span className={styles.tag}>
                    <span className={styles.dot} style={{ background: e.accent }} />
                    {e.tag}
                  </span>
                </div>
                <p className={styles.desc}>{e.desc}</p>
                <div className={styles.links}>
                  <a
                    className={styles.link}
                    href={e.code}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => out(e.code, `mcp-code-${e.name}`)}
                  >
                    {e.codeLabel}
                  </a>
                  {e.live && (
                    <a
                      className={`${styles.link} ${styles.linkMuted}`}
                      href={e.live}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => out(e.live!, `mcp-live-${e.name}`)}
                    >
                      {e.liveLabel}
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className={styles.footer}>
          The through-line: an MCP is worth building when it lets an agent touch a system I actually
          work with, in a way a chat transcript can't — my data, my servers, my process, my tools.
        </p>
      </div>
    </div>
  );
}
