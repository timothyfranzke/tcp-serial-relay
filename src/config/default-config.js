// src/config/default-config.js
module.exports = {
  // TCP Configuration (primary connection)
  tcpIp: '192.168.1.90',
  tcpPort: 10002,
  
  // Secondary Connection Configuration
  connectionType: 'serial', // 'serial' or 'tcp'
  
  // Serial Configuration (used when connectionType === 'serial')
  serialPath: '/dev/ttyUSB0',
  serialBaud: 9600,
  serialParity: 'odd',
  serialDataBits: 7,
  serialStopBits: 1,
  
  // TCP Configuration for secondary connection (used when connectionType === 'tcp')
  secondaryTcpIp: '192.168.1.91',
  secondaryTcpPort: 10003,
  
  // Connection Settings
  maxRetries: 3,
  retryDelay: 5000,
  connectionTimeout: 10000,
  
  // Relay Settings
  relayTimeout: 30000,
  bufferSize: 1024,
  
  // Logging Settings
  logDataTransfers: true,
  logLevel: 'info'
};