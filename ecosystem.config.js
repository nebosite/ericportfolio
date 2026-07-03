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
  ],
};
