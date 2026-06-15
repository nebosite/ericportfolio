# Claude Code — Project Instructions

## Workflow: local review before deploy

**For every change:** build and run the affected site locally so the user can
review it in a browser before committing to git or deploying to the VPS.

Steps:
1. Make the code change.
2. `npm run dev` (or `npm run build` + preview) in the affected app's `client/` directory.
3. Tell the user the local URL and ask them to check it.
4. Only after approval: `git commit`, `git push`, then deploy via `deploy.sh` or the
   SSH one-liner used in previous sessions.

## Workflow: tests are part of every change

Testing is **not optional** and must keep pace as the sites grow. The repo uses
**Vitest** in every workspace (jsdom + Testing Library for clients, supertest for
the Express servers). Run `npm test` from the repo root to execute the whole
suite across all eight workspaces (or `npm test -w apps/<app>/<client|server>`
for one).

For **every** change, before asking for local review / committing:

1. **Run the suite** (`npm test`) and make sure it is green. A change that turns
   tests red is not done.
2. **Add or update tests** for what you changed:
   - **Logic** (maze/pathfinding, snake rules, validation, scoring, date/cookie
     math, helpers): cover it with a direct unit test. If the logic is buried in
     a component or a pixi/canvas/Express module, **extract the pure part** into a
     plain module (see `games/big-pac-tiny-man/grid.ts`, `games/snake/snakeLogic.ts`,
     each server's `app.ts`) and test that.
   - **Graphical control behavior** (key handlers, timers/auto-advance, conditional
     rendering, callbacks, form validation, state transitions): cover it with a
     Testing Library behavior test. Do **not** try to unit-test actual pixel/canvas
     rendering — that stays in the manual browser review.
   - **API endpoints**: cover with supertest against `createApp(db)` using an
     in-memory SQLite database.
3. New feature ⇒ new tests in the same change. Bug fix ⇒ add a test that would
   have caught it. Never let coverage regress.

Keep test files next to the code as `*.test.ts` / `*.test.tsx`; they are excluded
from the production `tsc` build via each workspace's `tsconfig.json`.

## Standard feature: per-entity feedback

Every Big Tiny game and the PixelWhimsy app carries a **standard feedback
feature** on its title screen. New games/apps of this kind should include it too.

On the title screen there are two buttons:

- **Leave Feedback** — a form to submit up to **1000 characters** of feedback
  about that specific entity (the game or app).
- **Vote on Feedback** — shows **three randomly selected** items from that
  entity's active feedback list; the player can **upvote** ones they like (there
  are **no downvotes**). The browser's **localStorage** records which item ids the
  player has voted for, so they can't vote for the same item twice.

Implementation:

- **Client:** the reusable `components/FeedbackPanel.tsx` (`<FeedbackPanel
  entity="..." />`). "entity" is the game/app slug, e.g. `snake`,
  `big-pac-tiny-man`, `pixelwhimsy`. The component is currently duplicated per
  client app (no shared workspace) — keep the copies in sync.
- **Server:** `feedback.ts` (`initFeedbackTable` + `registerFeedbackRoutes`)
  wired into each `app.ts`, backed by a SQLite `feedback` table. Endpoints:
  `POST /api/feedback`, `GET /api/feedback/random?entity=<slug>`,
  `POST /api/feedback/:id/vote`. Per-browser vote dedupe is the client's job;
  the server just stores feedback and counts upvotes.
