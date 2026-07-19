import { LAYERED_DEVELOPMENT, layerDigest } from "./philosophy.js";

// The layered_development_coach PROMPT — the reason this is an MCP and not a
// REST API. A prompt packages a *workflow*: selected by an AI client, filled
// with the developer's context, and injected as a ready-to-run coaching turn.
//
// The name/description are written for an AI to SELECT correctly (see README):
// they say plainly when to reach for this and what it does, in the vocabulary a
// model matches against ("build software", "one step at a time", "instead of
// generating a whole app").

export const COACH_PROMPT_NAME = "layered_development_coach";

export const COACH_PROMPT = {
  name: COACH_PROMPT_NAME,
  title: "Layered Development Coach",
  description:
    "Coach a developer to build software one layer at a time by interviewing them, instead of generating a whole application at once. Select this when someone wants to start or grow an app/feature/project and would benefit from guided, iterative development that keeps working, shippable code at every step. The coach asks questions before assuming, adapts to the developer's experience level, advances through four layers (Blank Screen → First Breath → Grow by Observation → Polish), and resists jumping to advanced architecture prematurely.",
  arguments: [
    {
      name: "idea",
      description:
        "What the developer wants to build (a sentence or two). Optional — the coach will ask if omitted.",
      required: false,
    },
    {
      name: "experience",
      description:
        "The developer's experience level (e.g. beginner, intermediate, advanced), so the coach can calibrate. Optional.",
      required: false,
    },
  ],
} as const;

export interface CoachArgs {
  idea?: string;
  experience?: string;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface CoachPromptResult {
  description: string;
  messages: PromptMessage[];
}

/** Build the coach prompt's messages, weaving in the developer's context. */
export function buildCoachPrompt(args: CoachArgs = {}): CoachPromptResult {
  const idea = args.idea?.trim();
  const experience = args.experience?.trim();

  const layers = layerDigest()
    .map((l) => `${l.order}. ${l.name} — ${l.purpose} (done when: ${l.exitCriteria})`)
    .join("\n");
  const principles = LAYERED_DEVELOPMENT.principles.map((p) => `- ${p}`).join("\n");

  const context = [
    idea ? `What I want to build: ${idea}` : `I haven't told you yet what I want to build.`,
    experience ? `My experience level: ${experience}.` : `You don't know my experience level yet.`,
  ].join("\n");

  const text = `You are my **Layered Development Coach**. Help me build software the way a living thing grows: one layer at a time, always keeping working, shippable code. Do NOT generate a whole application up front.

The method has four layers:
${layers}

Principles that hold across every layer:
${principles}

How to coach me:
- **Interview before assuming.** Ask me focused questions and wait for answers before proposing anything. One topic at a time.
- **Adapt to my experience level.** ${
    experience
      ? `I described myself as "${experience}" — calibrate depth, jargon, and how much you explain accordingly.`
      : `Ask what my experience level is early, and calibrate depth and jargon to it.`
  }
- **Advance one layer at a time.** Figure out which layer I'm actually in and work only on that. Don't skip ahead.
- **Resist premature architecture.** Push back (kindly) if I try to jump to advanced patterns, frameworks, or scaling before the core idea runs.
- **Keep a place to stand.** After every step, I should have code that builds, runs, and is green.
- **Grow by observation.** Keep asking me to run it and tell you what you actually saw; turn observations into the next small change; only solve problems that actually exist.
- At **Blank Screen**, insist we also create a claude.md capturing the project's strong coding style and practices — above all, validating every change with passing unit tests — and suggest any MCPs/tools that would help. At **First Breath**, draw out the app's north star and record it in claude.md.

My situation:
${context}

Begin now. Determine which layer I'm in (for a brand-new idea, that's Blank Screen), then ask me your first one or two questions to get moving. Keep your turn short — coach me one step at a time.`;

  return {
    description: `Layered Development coaching session${idea ? ` for: ${idea}` : ""}`,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}
