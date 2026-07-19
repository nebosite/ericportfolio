// Curated portfolio projects and the Layered-Development lessons drawn from
// building them. This is the "examples" corpus the coach draws on — real
// projects, real lessons, each tied to a layer of the method. Hand-authored
// (not scraped) so the lessons are honest and specific.

export interface Lesson {
  /** Which layer of Layered Development this lesson illustrates. */
  layer: "Blank Screen" | "First Breath" | "Grow by Observation" | "Polish";
  /** What happened on the project. */
  lesson: string;
  /** The transferable takeaway. */
  takeaway: string;
}

export interface Project {
  id: string;
  name: string;
  /** Machine→hand category, matching the portfolio's taxonomy. */
  category: "Pure AI Output" | "Hand-Written, AI-Enhanced" | "Hand-Written Code" | "Pure Creative";
  /** One-line summary. */
  summary: string;
  /** A paragraph of detail. */
  description: string;
  url?: string;
  tech: string[];
  lessons: Lesson[];
}

export const PROJECTS: Project[] = [
  {
    id: "big-tiny-games",
    name: "Big Tiny Games",
    category: "Pure AI Output",
    summary: "Classic arcade games reimagined on a huge canvas with tiny hand-made pixel sprites.",
    description:
      "A suite of browser games (snake, invaders, pac, asteroids, pipe, a Robotron mashup) that share a big-canvas aesthetic, GA4 analytics, per-game leaderboards, and a per-game feedback panel. Each game is grown from an empty canvas into a playable toy.",
    url: "https://bigtinygames.com",
    tech: ["React", "TypeScript", "Canvas/Pixi", "Vitest", "Express", "SQLite"],
    lessons: [
      {
        layer: "Blank Screen",
        lesson: "Every game began as an empty canvas that rendered and had a single green test.",
        takeaway:
          "A runnable blank app plus a test-on-every-change habit beats a detailed up-front plan.",
      },
      {
        layer: "First Breath",
        lesson:
          "The first interactive build was always one core verb — a snake that moves, a maze you can walk.",
        takeaway: "Prove the one thing the game is about before adding anything adjacent.",
      },
      {
        layer: "Polish",
        lesson:
          "Pure logic (maze generation, snake rules, scoring, pathfinding) is extracted into framework-free modules and unit-tested; the canvas layer stays dumb.",
        takeaway:
          "Separate the tested 'brain' from the rendered 'body' so rules are provable without pixels.",
      },
    ],
  },
  {
    id: "big-robo-tiny-tron",
    name: "Big Robo Tiny Tron",
    category: "Pure AI Output",
    summary: "A Robotron + Berserk + Tron mashup: twin-stick shooting inside a big neon maze.",
    description:
      "A twin-stick shooter grown one mechanic at a time from a walkable maze: smooth pathfinding enemies, destructible electrodes, rescuable family members, sprite-sheet animation, oriented bullets, and a reconstitute respawn effect — each added as a small, tested increment.",
    url: "https://bigtinygames.com/big-robo-tiny-tron",
    tech: ["React", "TypeScript", "Canvas", "Web Audio", "Vitest"],
    lessons: [
      {
        layer: "First Breath",
        lesson:
          "It started as the smallest playable thing — a maze with a player you could move — then enemies, electrodes, family, and particles were layered on one at a time.",
        takeaway: "A big feature is really a stack of small proven increments, not one generation.",
      },
      {
        layer: "Grow by Observation",
        lesson:
          "Cell size, sprite scale, bullet speed and fire rate were all tuned by running the game and adjusting from what was actually seen on screen.",
        takeaway: "Tune against the running program, not against your imagination of it.",
      },
      {
        layer: "Polish",
        lesson:
          "Making bullets 3× faster exposed a tunneling bug (fast shots skipped past enemies between frames); a swept-collision fix plus a regression test closed it for good.",
        takeaway: "A bug you find by running becomes a permanent test, not just a fix.",
      },
    ],
  },
  {
    id: "feedback-service",
    name: "Portfolio Feedback Service",
    category: "Hand-Written, AI-Enhanced",
    summary: "One shared feedback store for every app, with a simple triage lifecycle.",
    description:
      "A small Express + SQLite service every app posts to (tagged by entity). It grew from a health check and one table into submit/vote/random endpoints, a password-gated admin API, and a Submitted → Suggested → Implemented triage lifecycle — each piece added when a real need appeared.",
    url: "https://ericjorgensen.com/manage/feedback",
    tech: ["Express", "TypeScript", "better-sqlite3", "supertest", "Vitest"],
    lessons: [
      {
        layer: "Blank Screen",
        lesson: "It began as a tiny service with a /api/health check and a single feedback table.",
        takeaway: "Ship the smallest running service first; endpoints are later layers.",
      },
      {
        layer: "Grow by Observation",
        lesson:
          "A 'Submitted' triage status was added only once real feedback started arriving and needed curating before public voting.",
        takeaway:
          "Add lifecycle and structure when a real need shows up — not speculatively up front.",
      },
      {
        layer: "Polish",
        lesson: "Every endpoint is covered by supertest against an in-memory SQLite database.",
        takeaway: "Grow the safety net exactly as fast as the API surface grows.",
      },
    ],
  },
  {
    id: "ericjorgensen-insights",
    name: "Feature-Request Insights MCP",
    category: "Pure AI Output",
    summary: "A remote, read-only MCP that exposes the portfolio's feature-request data to an AI.",
    description:
      "A bearer-gated MCP server over the feedback data with tools like top_requests, recent_activity, app_summary, and find_duplicates. Pure query functions do the work; the MCP layer just wraps them.",
    url: "https://ericjorgensen.com/mcp",
    tech: ["Express", "TypeScript", "@modelcontextprotocol/sdk", "SQLite", "Streamable HTTP"],
    lessons: [
      {
        layer: "Blank Screen",
        lesson:
          "It started as an Express health check plus a read-only DB open, then exactly one tool.",
        takeaway: "An MCP is just a small server — grow its tool surface one tool at a time.",
      },
      {
        layer: "Polish",
        lesson:
          "The query logic lives in pure, unit-tested functions; the transport layer is thin.",
        takeaway: "Test the knowledge, not the plumbing — keep the smarts out of the framework.",
      },
    ],
  },
  {
    id: "mentor-mcp",
    name: "Coding Mentor MCP",
    category: "Pure AI Output",
    summary:
      "A public MCP that coaches the Layered Development method — a workflow, not a data API.",
    description:
      "This server. It exposes a prompt (layered_development_coach) that interviews a developer and guides them one layer at a time, plus tools that return the philosophy and portfolio examples as structured data. It demonstrates that an MCP can package knowledge and process, not only endpoints.",
    url: "https://ericjorgensen.com/coach",
    tech: ["Express", "TypeScript", "@modelcontextprotocol/sdk", "Streamable HTTP"],
    lessons: [
      {
        layer: "First Breath",
        lesson:
          "The core idea — coach one layer at a time — is proven by the single prompt before any tool exists.",
        takeaway:
          "Lead with the one interaction that proves the concept; supporting tools are secondary layers.",
      },
    ],
  },
  {
    id: "clusterfun",
    name: "clusterfun.tv",
    category: "Hand-Written, AI-Enhanced",
    summary: "A Jackbox-style party-game framework, plus the games grown on top of it.",
    description:
      "A framework for phone-controlled party games. Its shape was earned from the games actually built on it rather than designed abstractly up front.",
    url: "https://clusterfun.tv",
    tech: ["TypeScript", "React", "WebSockets"],
    lessons: [
      {
        layer: "Grow by Observation",
        lesson:
          "The framework's abstractions came from patterns that repeated across real games, not from a speculative design.",
        takeaway: "Let a platform's shape emerge from the concrete things built on it.",
      },
    ],
  },
  {
    id: "talisman",
    name: "Talisman",
    category: "Hand-Written, AI-Enhanced",
    summary: "A focus aid for ADHD — insistent reminders, one-click timers, and global hot keys.",
    description:
      "A desktop companion (built by a programmer with ADHD) that turns easily-dismissed reminders into ones that demand a moment of cognition, plus quick timers and hot keys.",
    url: "https://github.com/nebosite/talisman",
    tech: ["TypeScript", "Desktop"],
    lessons: [
      {
        layer: "First Breath",
        lesson:
          "The proof was a single 'reminder you can't reflexively dismiss' — the one idea that makes the tool worth using.",
        takeaway: "Find and build the north-star interaction; everything else supports it.",
      },
    ],
  },
];

/** Compact catalog for the list_projects tool. */
export function listProjects(): Array<
  Pick<Project, "id" | "name" | "category" | "summary" | "url">
> {
  return PROJECTS.map(({ id, name, category, summary, url }) => ({
    id,
    name,
    category,
    summary,
    url,
  }));
}

/** Full detail for one project (or null if the id is unknown). */
export function getProject(id: string): Project | null {
  return PROJECTS.find((p) => p.id === id) ?? null;
}

export interface FlatLesson extends Lesson {
  projectId: string;
  project: string;
}

/** Lessons across projects (optionally one project), flattened for easy reading. */
export function getProjectLessons(projectId?: string): FlatLesson[] {
  const source = projectId ? PROJECTS.filter((p) => p.id === projectId) : PROJECTS;
  return source.flatMap((p) => p.lessons.map((l) => ({ projectId: p.id, project: p.name, ...l })));
}
