module.exports = {
  apps: [
    {
      name: 'wpbot',
      script: 'bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        DOWNLOAD_MAX_AGE_HOURS: '4',
        MAX_DOWNLOADS_CACHE_GB: '15'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      time: true
    }
  ]
};
