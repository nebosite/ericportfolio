# Portfolio MCP servers

Two small [MCP](https://modelcontextprotocol.io) servers that give Claude Code
(or any MCP client) first-class, **read-only** access to this repo's live data
and production box — so questions like _"what feedback came in for
big-robo-tiny-tron?"_ or _"are all the services healthy?"_ are one tool call
instead of hand-written SQL or a manual SSH session.

They're wired up for this repo via the project-scoped [`.mcp.json`](../../.mcp.json)
at the repo root (so anyone who opens the repo gets them), using the stdio
transport. Both are plain ESM run directly with `node` — no build step.

## Servers

### `portfolio-db` — read-only SQLite (`db-server.mjs`)

Queries the **feedback** DB (`apps/feedback/server/data.db`) and the Big Tiny
Games **leaderboard** DB (`apps/bigtinygames/server/data.db`). Connections are
opened `readonly` **and** every statement is allow-listed to `SELECT` / `WITH` /
`PRAGMA` (single statement only), so it can never mutate data.

Tools: `list_databases`, `list_tables`, `describe_table`, `query`.

Point it at other copies of the DBs (e.g. one pulled from the VPS) with env vars:
`DB_FEEDBACK_PATH`, `DB_LEADERBOARDS_PATH`.

### `portfolio-ops` — VPS health/PM2/logs (`ops-server.mjs`)

Runs **read-only** commands on the production VPS over SSH: health-checks every
service, reads PM2 status, and tails recent logs. It never deploys or restarts
anything.

Tools: `health_check` (curls `/api/health` on ports 3001–3005 + the feedback
admin 401 gate), `pm2_status`, `tail_log`.

Connection defaults match this repo's VPS and can be overridden with env vars:

- `PORTFOLIO_SSH_HOST` — default `root@198.71.56.24`
- `PORTFOLIO_SSH_KEY` — default `~/.ssh/id_ed25519_portfolio`

The private key never leaves your machine — only its **path** is referenced, so
no secret is ever stored in `.mcp.json`.

## Using them

1. **Restart Claude Code** in this repo — `.mcp.json` is read at session start, so
   new servers only appear after a fresh session.
2. Check they connected: `/mcp` (or `claude mcp list`). You'll see `portfolio-db`
   and `portfolio-ops`.
3. (Optional) allow-list their tools to skip approval prompts: `/permissions` →
   add `mcp__portfolio-db__*` and `mcp__portfolio-ops__*`.

## Smoke-testing without Claude

Each server speaks newline-delimited JSON-RPC on stdio, so you can drive it
directly, e.g. list tools and run a query:

```bash
node scripts/mcp/db-server.mjs   # then send initialize / tools/list / tools/call
```

## Safety

- **Read-only by construction.** The DB server rejects any non-`SELECT` and opens
  the files `readonly`; the ops server only issues read commands.
- **No secrets committed.** Host/key are env-configurable and default to a public
  IP + a key path; the key itself stays on your disk.
- MCP tool *output* is untrusted text — these servers only ever touch your own
  DBs and VPS, which keeps that surface small.
