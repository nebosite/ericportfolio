# Portfolio Monorepo

Four independent client/server web apps on one VPS, routed by hostname:

| Domain                                         | App             | Personality                                         |
| ---------------------------------------------- | --------------- | --------------------------------------------------- |
| [ericjorgensen.com](https://ericjorgensen.com) | `ericjorgensen` | Professional portfolio + guestbook (primary domain) |
| [pixelwhimsy.com](https://pixelwhimsy.com)     | `pixelwhimsy`   | Children's pixel-art toy                            |
| [thejcrew.net](https://thejcrew.net)           | `thejcrew`      | Family bulletin board                               |
| [bigtinygames.com](https://bigtinygames.com)   | `bigtinygames`  | Big Tiny Snake + leaderboard                        |

This README is the **complete rematerialization guide**: starting from a fresh
Ubuntu 22.04 VPS and this repository, you can bring the entire system back up
by following it top to bottom.

---

## 1. Architecture overview

```
                         ┌──────────────────────────── VPS (Ubuntu 22.04) ───┐
        DNS A records    │                                                   │
  ericjorgensen.com ──┐  │   ┌────────┐  static: apps/<slug>/client/dist     │
  pixelwhimsy.com ────┤  │   │        │──────────────────────────────┐       │
  thejcrew.net ───────┼──┼──▶│ nginx  │  /api/* proxied by hostname  │       │
  bigtinygames.com ───┘  │   │ 80/443 │───┬──────────┬──────┬────────┤       │
                         │   └────────┘   ▼          ▼      ▼        ▼       │
                         │            :3001       :3002  :3003    :3004      │
                         │         ericjorgensen  pixel  thejcrew  bigtiny   │
                         │            -api        whimsy  -api     games-api │
                         │              │          -api     │        │       │
                         │              ▼            │      ▼        ▼       │
                         │           data.db     data.db  data.db  data.db   │
                         │                                                   │
                         │   PM2 manages all four Express processes          │
                         └───────────────────────────────────────────────────┘
```

- Each app is a React SPA (Vite + TypeScript) served by nginx as static files.
- Each app has its own Express/TypeScript API and its own SQLite database
  (`apps/<slug>/server/data.db`, created automatically on first startup).
- nginx routes by `server_name` and proxies `/api/*` to the matching port.
- PM2 keeps the four Express processes alive and restarts them on reboot.

## 2. Prerequisites

Before running any script you need:

1. **SSH access** to the VPS as `root` (IP: `198.71.56.24`).
2. **This repository** pushed to a git remote the VPS can reach (GitHub, etc.).
3. **DNS control** for all four domains, with A records pointed at the VPS IP
   (required before SSL setup; see section 4).

## 3. First-time provisioning

```bash
# 1. From your machine, copy the provisioning script to the server
scp scripts/provision.sh root@198.71.56.24:/root/

# 2. SSH in and run it (prompts for the git repo URL to clone)
ssh root@198.71.56.24
bash /root/provision.sh

# 3. Once DNS has propagated (section 4), enable HTTPS
bash /var/www/portfolio/scripts/ssl-setup.sh
```

`provision.sh` is idempotent — re-running it is safe. It installs system
packages, Node 20 (via nvm in `/opt/nvm`, exposed system-wide through
`/usr/local/bin`), PM2, clones the repo into `/var/www/portfolio`, builds all
four apps, installs nginx configs, and starts PM2 with a systemd startup hook.

Until certificates exist, nginx serves each domain over plain HTTP.
`ssl-setup.sh` obtains per-domain Let's Encrypt certificates and re-runs
`nginx-gen.sh`, which then installs the full HTTPS configs from `nginx/`.

## 4. DNS setup

Create these records at your DNS provider (IONOS) for **each** domain:

| Type | Host  | Value          |
| ---- | ----- | -------------- |
| A    | `@`   | `198.71.56.24` |
| A    | `www` | `198.71.56.24` |

Domains: `ericjorgensen.com`, `pixelwhimsy.com`, `thejcrew.net`,
`bigtinygames.com`. Wait for propagation (`dig +short <domain>` should return
the VPS IP) before running `ssl-setup.sh`.

## 5. Deploying changes

Push to the git remote, then on the server:

```bash
ssh root@198.71.56.24
bash /var/www/portfolio/scripts/deploy.sh
```

`deploy.sh` runs `git pull`, `npm install`, rebuilds all four apps, and
gracefully reloads the PM2 processes.

## 6. Adding a new app

1. Create `apps/<slug>/client` and `apps/<slug>/server` following an existing
   app's structure (copy `ericjorgensen` as a template). The workspace globs in
   the root `package.json` pick the new packages up automatically.
2. Pick the next free port (3005) and use it in the server's default `PORT`,
   the client's Vite proxy, and the `.env.example`.
3. Add a `nginx/<slug>.conf` (copy an existing one; change domain, dist path,
   port) and add the `slug:domain:port` entry to the `APPS` array in
   `scripts/nginx-gen.sh`.
4. Add a PM2 entry to `ecosystem.config.js`.
5. Add the domain to the `DOMAINS` array in `scripts/ssl-setup.sh`.
6. Optionally add a `build:<slug>` script to the root `package.json`
   (the catch-all `npm run build` already covers it).
7. Point the new domain's DNS at the server, deploy, then run
   `nginx-gen.sh` and `ssl-setup.sh` on the server.

## 7. Troubleshooting

**A site returns 502 Bad Gateway**
nginx is up but the Express process behind it is down.

```bash
pm2 status                      # is the app online?
pm2 logs <slug>-api --lines 50  # why did it crash?
pm2 restart <slug>-api
```

**A site returns the wrong app or nginx default page**
The nginx config for that domain is missing or disabled.

```bash
ls /etc/nginx/sites-enabled/
bash /var/www/portfolio/scripts/nginx-gen.sh
```

**Certificate expired / renewal issues**
Certbot installs a systemd timer that renews automatically. To check or force:

```bash
systemctl list-timers | grep certbot
certbot renew --dry-run
certbot renew
```

**Changes deployed but the site looks stale**
The client build may have failed silently in an old deploy. Rebuild and check:

```bash
cd /var/www/portfolio && npm run build
ls -la apps/<slug>/client/dist/
```

**Database questions**
Each SQLite DB lives at `apps/<slug>/server/data.db` on the server. They are
gitignored and self-bootstrap (CREATE TABLE IF NOT EXISTS) on server startup.
To back them up:

```bash
tar czf ~/portfolio-dbs-$(date +%F).tgz /var/www/portfolio/apps/*/server/data.db
```

## 8. Port reference

| App           | Domain            | Internal port | PM2 process         |
| ------------- | ----------------- | ------------- | ------------------- |
| ericjorgensen | ericjorgensen.com | 3001          | `ericjorgensen-api` |
| pixelwhimsy   | pixelwhimsy.com   | 3002          | `pixelwhimsy-api`   |
| thejcrew      | thejcrew.net      | 3003          | `thejcrew-api`      |
| bigtinygames  | bigtinygames.com  | 3004          | `bigtinygames-api`  |

Ports are bound to localhost behind nginx and never exposed publicly.

## 9. Local development

Requires Node 20+. From the repo root, install everything once:

```bash
npm install
```

Then run any app with two terminals:

```bash
# Terminal 1 — Express API (tsx watch mode)
cd apps/<slug>/server && npm run dev

# Terminal 2 — React dev server (Vite proxies /api/* to the API)
cd apps/<slug>/client && npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). The SQLite DB file
is created automatically next to the server's `package.json` on first run.

Build everything exactly as production does:

```bash
npm run build              # all four apps
npm run build:<slug>       # just one app
```
