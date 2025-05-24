module.exports = {
  apps: [
    {
      name: 'tcp-serial-relay-updater',
      script: './scripts/update-manager.js',
      args: '--auto-run',
      autorestart: false,
      watch: false,
      cron_restart: '0 3 * * *', // Default: Daily at 3:00 AM
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
