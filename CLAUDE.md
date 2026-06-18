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

## Deployment: catching errors before they ship

Deploys run on the VPS via `scripts/deploy.sh`:
**preflight → `git pull --ff-only` → `npm ci` → `npm run build` →
`pm2 startOrReload` → smoke test.** Two guard scripts bracket the deploy so the
failure modes we've actually hit can't silently ship stale or broken code.

- **`scripts/preflight.sh`** runs first and **aborts the deploy** on anything it
  can't safely fix:
  - **Dirty working tree.** A non-clean tree blocks `git pull`. The one artifact
    it auto-heals is a drifted `package-lock.json` (older `npm install`s rewrote
    it; `npm ci` no longer does). Any *other* uncommitted change aborts with a
    list, so you resolve it by hand instead of deploying around it. *(This is the
    exact failure that once left stale code live in production.)*
  - **Wrong branch / diverged history.** Refuses unless on `main` and able to
    fast-forward to `origin/main` (stray commits made on the server abort).
  - **Missing `ADMIN_TOKEN`.** Warns if `/root/portfolio.env` has none (the
    feedback admin API would be closed).
- **`scripts/smoke-test.sh`** runs last and **fails the deploy** if any service
  is unhealthy: it hits `/api/health` on every PM2 service (ports 3001–3005) on
  localhost and confirms the feedback admin API rejects an unauthenticated
  request (401). It **retries each check for ~15s** so a just-reloaded service
  that hasn't finished binding its port isn't reported as a false failure.

**The VPS is RAM-constrained (~1GB).** `npm ci` compiling native modules
(better-sqlite3 ×3) plus the vite builds will be **OOM-killed without swap**
(seen in a real deploy: `Killed npm ci`). `provision.sh` creates a persistent
2G swapfile; if you ever move to a fresh box, make sure swap exists before the
first build (`free -h` should show non-zero Swap).

**Rule:** when you add a service or a critical endpoint, add a check to
`smoke-test.sh`; when you hit a new class of deploy failure, encode the guard in
`preflight.sh`. Turn every one-off deploy fix into a permanent pre-flight check
rather than a thing to remember.

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

Implementation — there is **one shared feedback database** for the whole
portfolio, owned by a dedicated service. Do not add per-app feedback tables.

- **Service:** `apps/feedback/server` (port 3005) owns the single SQLite
  `feedback` table for every entity. Public endpoints: `POST /api/feedback`,
  `GET /api/feedback/random?entity=<slug>`, `POST /api/feedback/:id/vote`.
  Per-browser vote dedupe is the client's job; the service stores feedback and
  counts upvotes. Each row also has a `status` (`Suggested` | `Implemented`).
- **Client panel:** the reusable `components/FeedbackPanel.tsx` (`<FeedbackPanel
  entity="..." />`), duplicated per client app (no shared workspace) — keep the
  copies in sync. It calls relative `/api/feedback*`; routing sends those to the
  shared service (nginx `location /api/feedback` → 3005 in prod; the per-app vite
  proxy `'/api/feedback' → 3005` in dev).
- **Admin console:** a secret, password-gated page at
  `ericjorgensen.com/manage/feedback` (`apps/ericjorgensen/client` →
  `pages/FeedbackAdminPage.tsx`). Sortable by entity/date/votes/status, highlights
  entries new since the last visit, and can delete or change status. It calls the
  service's admin API (`GET/PATCH/DELETE /api/admin/feedback`), gated by a
  `Bearer` token checked against the `ADMIN_TOKEN` env var. Routing: nginx
  `location /api/admin/` → 3005 on ericjorgensen.com; dev vite proxy
  `'/api/admin' → 3005`.
- **Secret/`ADMIN_TOKEN`:** never committed. `provision.sh` generates one into
  `/root/portfolio.env` (chmod 600) and prints it once; `deploy.sh` sources that
  file so PM2 picks it up via `--update-env`. If `ADMIN_TOKEN` is unset the admin
  API is closed entirely.
