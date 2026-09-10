module.exports = {
  apps: [
    {
      name: 'jlpt-api',
      script: 'dist/src/main.js',
      cwd: '/var/www/jlpt-api',
      instances: 1,
      autorestart: true,
      max_memory_restart: '450M',
      env: { NODE_ENV: 'production', PORT: 4500 },
    },
  ],
};
