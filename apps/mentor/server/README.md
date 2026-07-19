# Coding Mentor MCP

A **public, read-only [MCP](https://modelcontextprotocol.io) server** for the
portfolio, served at **`https://ericjorgensen.com/coach`**. Its purpose isn't to
expose data — it's to expose a **workflow and a philosophy**: how I think good
software gets built, iteratively, one layer at a time.

Its centerpiece is a **prompt**, not a tool:

- **Prompt — `layered_development_coach`** — coaches a developer to build software
  one layer at a time by _interviewing_ them, instead of generating a whole app at
  once. It advances through four layers (Blank Screen → First Breath → Grow by
  Observation → Polish), asks before assuming, and adapts to the developer's
  experience level.
- **Tools** (supporting knowledge, all returning structured JSON):
  `list_projects`, `get_project`, `get_project_lessons`,
  `get_layered_development_philosophy`.

## Why an MCP instead of a REST API

A REST API exposes **data and operations** to a program that already knows what it
wants. MCP exposes **capabilities to a reasoning agent** that has to _decide_ what
it wants. Three things fall out of that difference and make MCP the right fit here:

1. **Prompts are a first-class primitive.** The thing I most want to share is a
   _way of working_, not a payload. In MCP that's a `prompt`: a reusable, named,
   argument-filled workflow an AI can select and run. A REST endpoint can return
   the _text_ of a philosophy, but it can't offer the model a labeled workflow it
   knows _when_ to reach for. The coach is a prompt precisely because it's a
   process, not a resource.
2. **Discovery is built in and semantic.** An MCP client lists prompts/tools with
   natural-language descriptions and lets the model match intent to capability at
   runtime. REST has no standard "here's what I can do, and when you'd want it"
   channel — you read docs and hard-code calls.
3. **One integration, many hosts.** Any MCP-aware client (Claude Code, Claude
   Desktop, others) can use this with zero bespoke glue. A REST API would need a
   custom client per host.

## How an LLM discovers and selects MCP prompts and tools

1. On connect, the client calls `prompts/list` and `tools/list`. The server
   returns each capability's **name, description, and argument schema**.
2. When the user expresses intent ("help me start building X"), the model matches
   that intent against those **descriptions** — not the code — and picks the best
   fit. Good descriptions are therefore the actual API.
3. For a prompt, the client calls `prompts/get` with arguments (e.g. `idea`,
   `experience`); the server returns ready-to-use **messages** that get injected
   into the conversation. For a tool, the client calls `tools/call` and gets
   **structured JSON** back to reason over.

Because selection happens over descriptions, the descriptions are written for a
_model reader_, not a human skimmer.

## Why the prompt/tool descriptions are written carefully

The `layered_development_coach` description leads with the trigger and the
contrast in the vocabulary a model matches on: _"build software one layer at a
time by interviewing them, **instead of generating a whole application at once**…
select this when someone wants to start or grow an app/feature/project."_ That
sentence is doing selection work: it tells the model **when** to choose this,
**what** it does, and **what it is not** (a one-shot generator). Tool descriptions
say what each returns and when to use it ("use to ground coaching advice in
concrete examples"), so the model chains them sensibly. Vague descriptions are the
most common reason a good capability never gets picked.

## Why it's intentionally public and read-only

- **No user data, no writes** — it serves static knowledge (a coaching prompt and
  hand-authored portfolio examples). There's nothing to protect and nothing to
  corrupt, so authentication would add friction for zero safety.
- **Discoverability is the point.** A coaching philosophy is only useful if
  anyone's agent can reach it. Public + no-auth means any MCP client can connect
  and immediately find the coach.
- Contrast with the sibling **insights** MCP (`/mcp`), which _is_ bearer-gated —
  because it reads real feedback data. Same house, opposite posture, for the right
  reasons.

## Example conversations (the AI selecting the coach)

> **User:** "I want to build a little web app that shows the tide times for my
> town. Where do I start?"
> **AI (having listed prompts):** matches the intent to
> `layered_development_coach` → calls `prompts/get { idea: "tide-times web app" }`
> → begins by asking about platform and the smallest runnable page, and proposes a
> claude.md — rather than dumping a full app.

> **User:** "Coach me through building a CLI todo tool. I'm newish to Rust."
> **AI:** selects the coach with `{ idea: "CLI todo tool", experience: "beginner
in Rust" }`; the returned prompt calibrates depth to a beginner and starts at
> Blank Screen with one runnable command + a test.

> **User:** "What's the philosophy behind how these projects were built?"
> **AI:** this is a knowledge lookup, not a coaching session, so it calls the
> **tool** `get_layered_development_philosophy` (and maybe `get_project_lessons`)
> and answers — correctly _not_ starting a coaching interview.

> **User:** "Give me an example of iterating from feedback in a real project."
> **AI:** calls `get_project_lessons { projectId: "feedback-service" }`, gets the
> "Grow by Observation" lesson, and grounds its answer in it.

That last pair matters: a well-described prompt-vs-tool split lets the model tell
_"coach me"_ (run the workflow) from _"tell me about"_ (fetch structured data).

## Design / where things live

- `philosophy.ts` — the Layered Development method as typed, structured data (one
  source of truth; unit-tested).
- `projects.ts` — curated portfolio projects + layer-tagged lessons, with
  `listProjects` / `getProject` / `getProjectLessons`.
- `coach.ts` — `buildCoachPrompt(args)`: the carefully-worded coaching prompt,
  woven with the developer's `idea` / `experience`.
- `mcp.ts` — the MCP `Server`: registers the prompt (`prompts/list` + `get`) and
  the four tools (`tools/list` + `call`).
- `app.ts` / `index.ts` — a public Express endpoint serving MCP over **Streamable
  HTTP** at `/coach` (stateful sessions), plus `/api/health`.
- `mentor.test.ts` / `app.test.ts` — unit tests for the knowledge + prompt and the
  HTTP surface.

## Connect from Claude Code

No token — it's public:

```bash
claude mcp add --transport http coding-mentor https://ericjorgensen.com/coach
```

Then ask your agent to help you start building something, and watch it reach for
the **Layered Development Coach**.
