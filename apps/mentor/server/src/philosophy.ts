// The "Layered Development" philosophy as structured data. This is the knowledge
// the Coding Mentor MCP exposes — both as a tool (get_layered_development_
// philosophy) and woven into the layered_development_coach prompt. Keeping it
// here, typed and framework-free, means one source of truth that's unit-tested.

export interface Layer {
  /** 1-based order. */
  order: number;
  /** Short name of the layer. */
  name: string;
  /** What this layer is FOR — its intent in one sentence. */
  purpose: string;
  /** Concrete practices that belong to this layer. */
  practices: string[];
  /** The signal that you've done enough here and can move on. */
  exitCriteria: string;
  /** What the coach should be doing/asking while the developer is in this layer. */
  coachFocus: string;
}

export interface Philosophy {
  name: string;
  summary: string;
  layers: Layer[];
  /** The invariants that hold across every layer. */
  principles: string[];
  /** Things the method deliberately pushes back on. */
  antiPatterns: string[];
}

export const LAYERED_DEVELOPMENT: Philosophy = {
  name: "Layered Development",
  summary:
    "Build software the way a living thing grows: start from the smallest runnable seed and add one layer at a time, always keeping working, shippable code. Solve real problems as they appear rather than imagined ones up front.",
  layers: [
    {
      order: 1,
      name: "Blank Screen",
      purpose: "Get from nothing to the smallest thing that actually runs on the target platform.",
      practices: [
        "Decide the target platform and runtime first (web, CLI, mobile, service, game).",
        "Create the smallest application that builds and runs — a blank window, an empty page, a 'hello' endpoint.",
        "Write a claude.md that states the strong coding style and practices for this project, above all: validate every change with passing unit tests.",
        "List MCPs or tools that would help this project (e.g. a browser-driver for UI, a DB reader, a docs source) and wire up the ones that clearly pay off.",
      ],
      exitCriteria:
        "The empty app builds, runs, and its test command is green (even with one trivial test).",
      coachFocus:
        "Nail the platform and the smallest runnable scaffold. Establish the test-on-every-change habit and the claude.md now, before any features exist.",
    },
    {
      order: 2,
      name: "First Breath",
      purpose: "Prove the core idea with the smallest interactive feature that makes it real.",
      practices: [
        "Implement the single smallest interaction that demonstrates the core idea working end to end.",
        "Draw out the app's north star — the one sentence about what makes it worth building — and record it in claude.md.",
        "Cover the new behavior with a test before moving on.",
      ],
      exitCriteria:
        "A person can do the one core thing the app is about, the north star is written down, and tests are green.",
      coachFocus:
        "Interview for the north star. Resist scope: exactly one interactive feature that proves the idea, nothing adjacent yet.",
    },
    {
      order: 3,
      name: "Grow by Observation",
      purpose: "Let the real, running program tell you what to build next.",
      practices: [
        "Run the program frequently — after almost every change — and watch it behave.",
        "Only solve problems that actually exist right now; defer imagined future ones.",
        "Add each next feature as a small, tested increment on top of working code.",
      ],
      exitCriteria:
        "The app does what it needs to do; the remaining issues are quality, not existence.",
      coachFocus:
        "Keep asking 'did you run it? what did you actually see?'. Turn observations into the next small change. Refuse speculative features.",
    },
    {
      order: 4,
      name: "Polish",
      purpose: "Improve the qualities of a thing that already fundamentally works.",
      practices: [
        "Improve architecture, UX, performance, testing depth, and maintainability — now that the app works.",
        "Refactor behind the safety net of tests, one improvement at a time.",
        "Harden the edges: error handling, accessibility, docs.",
      ],
      exitCriteria: "The app is not just working but pleasant, robust, and maintainable.",
      coachFocus:
        "Only enter here once the app fundamentally works. Prioritize polish by real friction observed, not by architectural fashion.",
    },
  ],
  principles: [
    "Solve problems one at a time, organically — the next problem reveals itself from the running program.",
    "Iterate frequently on small changes rather than big-bang rewrites.",
    "Always maintain a place to stand: working, shippable code at every step.",
  ],
  antiPatterns: [
    "Generating a whole application at once before anything has run.",
    "Designing advanced architecture before the core idea is proven.",
    "Solving imagined future problems instead of the one in front of you.",
    "Letting the tree go red — stacking changes without keeping tests green and the app runnable.",
  ],
};

/** The philosophy as plain structured data (for the get_..._philosophy tool). */
export function philosophyAsStructuredData(): Philosophy {
  return LAYERED_DEVELOPMENT;
}

/** A compact, prose-free layer digest for embedding in the coach prompt. */
export function layerDigest(): Array<Pick<Layer, "order" | "name" | "purpose" | "exitCriteria">> {
  return LAYERED_DEVELOPMENT.layers.map(({ order, name, purpose, exitCriteria }) => ({
    order,
    name,
    purpose,
    exitCriteria,
  }));
}
