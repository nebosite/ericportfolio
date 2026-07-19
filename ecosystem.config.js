module.exports = {
  apps: [
    {
      name: "ericjorgensen-api",
      cwd: "/var/www/portfolio/apps/ericjorgensen/server",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 3001 },
    },
    {
      name: "pixelwhimsy-api",
      cwd: "/var/www/portfolio/apps/pixelwhimsy/server",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 3002 },
    },
    {
      name: "thejcrew-api",
      cwd: "/var/www/portfolio/apps/thejcrew/server",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 3003 },
    },
    {
      name: "bigtinygames-api",
      cwd: "/var/www/portfolio/apps/bigtinygames/server",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 3004 },
    },
    {
      // Single, app-agnostic feedback store + secret admin API for all sites.
      // ADMIN_TOKEN must be present in the deploy environment (it is read from
      // the server's env, never committed). Deploy with `pm2 reload
      // ecosystem.config.js --update-env` after `export ADMIN_TOKEN=...`.
      name: "feedback-api",
      cwd: "/var/www/portfolio/apps/feedback/server",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 3005, ADMIN_TOKEN: process.env.ADMIN_TOKEN },
    },
    {
      // Remote MCP endpoint for ericjorgensen.com (feature-request insights).
      // Reads the shared feedback DB read-only. INSIGHTS_TOKEN gates the /mcp
      // endpoint; if unset the endpoint is closed. Provisioned into the deploy
      // env like ADMIN_TOKEN (see provision.sh / /root/portfolio.env).
      name: "insights-api",
      cwd: "/var/www/portfolio/apps/insights/server",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: 3006,
        INSIGHTS_TOKEN: process.env.INSIGHTS_TOKEN,
        FEEDBACK_DB_PATH: "/var/www/portfolio/apps/feedback/server/data.db",
      },
    },
    {
      // Public, read-only Coding Mentor MCP (ericjorgensen.com/coach) — serves a
      // coaching prompt + portfolio examples. No auth, no database, no secrets.
      name: "mentor-api",
      cwd: "/var/www/portfolio/apps/mentor/server",
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: 3007 },
    },
  ],
};
