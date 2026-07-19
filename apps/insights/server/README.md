# insights-api — remote MCP for ericjorgensen.com

A small service that exposes the portfolio's **feature-request (feedback) data**
to Claude (or any MCP client) as **read-only** tools, over **Streamable HTTP** at
`https://ericjorgensen.com/mcp`. It answers questions like _"what's top priority
for users in big-space-tiny-invaders?"_, _"how much feature-request activity was
there this week?"_, and _"which requests look like duplicates?"_ without exporting
data or writing SQL by hand.

Cross-app **usage analytics (GA4)** is a planned follow-up — the site only has the
client gtag today, so reading usage back needs the GA4 Data API (a service account
+ property id). The tool surface here is structured so those tools drop in later.

## Design

- **Read-only.** Opens the shared feedback SQLite DB (owned/written by
  `feedback-api`) with `readonly: true`, so it can never mutate data. Runs
  alongside the writer (SQLite WAL allows concurrent readers).
- **Bearer-gated.** The `/mcp` endpoint requires `Authorization: Bearer
  $INSIGHTS_TOKEN`. If `INSIGHTS_TOKEN` is unset the endpoint is closed entirely
  (like the feedback admin API). `/api/health` is open (for smoke tests).
- **Stateful Streamable HTTP.** An `initialize` POST mints an `mcp-session-id`;
  subsequent requests carry it. Transports are kept in memory per session and
  torn down on close.
- **Pure core.** `insights.ts` holds framework-free query functions (unit-tested
  in `insights.test.ts`); `mcp.ts` wraps them as MCP tools; `app.ts` is the HTTP
  + auth + transport layer.

## Tools

| Tool | Answers |
|------|---------|
| `top_requests {entity, limit?}` | Highest-voted open requests for an app — "top priorities". |
| `list_requests {entity, status?, limit?}` | All active requests for an app (optionally by status). |
| `recent_activity {days?}` | New requests in the last N days, per app (default 7). |
| `app_summary {}` | Per-app request counts by status + votes (engagement proxy). |
| `find_duplicates {entity?, threshold?}` | Candidate duplicate requests by wording overlap (Jaccard). |

## Ports / deploy

- PM2 service `insights-api` on **:3006** (see `ecosystem.config.js`), env
  `INSIGHTS_TOKEN` + `FEEDBACK_DB_PATH`.
- nginx routes `ericjorgensen.com/mcp` → `:3006` (see `nginx/ericjorgensen.conf`;
  installed via `scripts/nginx-gen.sh`, which is not run by `deploy.sh` — reload
  nginx separately when the conf changes).
- `INSIGHTS_TOKEN` is provisioned into `/root/portfolio.env` (see
  `scripts/provision.sh`), the same way as `ADMIN_TOKEN`.
- `scripts/smoke-test.sh` checks `:3006/api/health` and that `/mcp` returns 401
  unauthenticated.

## Connect from Claude Code

```bash
claude mcp add --transport http ej-insights https://ericjorgensen.com/mcp \
  --header "Authorization: Bearer <INSIGHTS_TOKEN>"
```
