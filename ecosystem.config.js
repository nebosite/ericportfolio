module.exports = {
  apps: [
    {
      name: 'ericjorgensen-api',
      cwd: '/var/www/portfolio/apps/ericjorgensen/server',
      script: 'dist/index.js',
      env: { NODE_ENV: 'production', PORT: 3001 },
    },
    {
      name: 'pixelwhimsy-api',
      cwd: '/var/www/portfolio/apps/pixelwhimsy/server',
      script: 'dist/index.js',
      env: { NODE_ENV: 'production', PORT: 3002 },
    },
    {
      name: 'thejcrew-api',
      cwd: '/var/www/portfolio/apps/thejcrew/server',
      script: 'dist/index.js',
      env: { NODE_ENV: 'production', PORT: 3003 },
    },
    {
      name: 'bigtinygames-api',
      cwd: '/var/www/portfolio/apps/bigtinygames/server',
      script: 'dist/index.js',
      env: { NODE_ENV: 'production', PORT: 3004 },
    },
  ],
};
