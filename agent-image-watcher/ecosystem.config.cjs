// 📁 agent-image-watcher/ecosystem.config.cjs
// Config de PM2 para correr el watcher como proceso supervisado:
// reinicio automático si crashea, logs a archivo, arranque con el SO.
module.exports = {
  apps: [
    {
      name: 'henko-agent',
      script: 'productImageFolderAgent.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
}
