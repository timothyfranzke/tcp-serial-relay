module.exports = {
  apps: [
    {
      name: 'tcp-serial-relay',
      script: './src/app.js',
      cwd: '/opt/tcp-serial-relay',
      user: 'relay',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 * * * *',
      restart_delay: 5000,
      autorestart: false,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        CONFIG_PATH: '/etc/tcp-serial-relay/relay-config.json'
      },
      log_file: '/var/log/tcp-serial-relay/combined.log',
      out_file: '/var/log/tcp-serial-relay/out.log',
      error_file: '/var/log/tcp-serial-relay/error.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      retain_logs: 10
    },
    {
      name: 'tcp-serial-relay-iot-sidecar',
      script: './src/iot-sidecar.js',
      cwd: '/opt/tcp-serial-relay',
      user: 'relay',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        CONFIG_PATH: '/etc/tcp-serial-relay/relay-config.json',
        IOT_THING_NAME: 'tcp-serial-relay-device',
        IOT_CERT_PATH: '/etc/tcp-serial-relay/certs/certificate.pem.crt',
        IOT_KEY_PATH: '/etc/tcp-serial-relay/certs/private.pem.key',
        IOT_CA_PATH: '/etc/tcp-serial-relay/certs/AmazonRootCA1.pem',
        IOT_ENDPOINT: ''
      },
      log_file: '/var/log/tcp-serial-relay/iot-sidecar-combined.log',
      out_file: '/var/log/tcp-serial-relay/iot-sidecar-out.log',
      error_file: '/var/log/tcp-serial-relay/iot-sidecar-error.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      retain_logs: 10
    }
  ]
};