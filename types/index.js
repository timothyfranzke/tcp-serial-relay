// src/types/index.js

/**
 * Application constants and type definitions
 */

// Connection states
const CONNECTION_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
  };
  
  // Relay directions
  const RELAY_DIRECTIONS = {
    TCP_TO_SERIAL: 'tcp-to-serial',
    SERIAL_TO_TCP: 'serial-to-tcp'
  };
  
  // Log levels
  const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    SILLY: 'silly'
  };
  
  // Event types
  const EVENT_TYPES = {
    // Connection events
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    CONNECTION_ERROR: 'connectionError',
    
    // Data events
    DATA_RECEIVED: 'data',
    DATA_SENT: 'dataSent',
    DATA_RELAYED: 'dataRelayed',
    
    // Relay events
    RELAY_STARTED: 'started',
    RELAY_STOPPED: 'stopped',
    RELAY_ERROR: 'relayError',
    RELAY_TIMEOUT: 'timeout',
    RELAY_COMPLETED: 'completed',
    
    // Application events
    APP_STARTED: 'appStarted',
    APP_STOPPED: 'appStopped',
    CLIENT_DISCONNECTED: 'clientDisconnected'
  };
  
  // Error codes
  const ERROR_CODES = {
    // Configuration errors
    CONFIG_LOAD_FAILED: 'CONFIG_LOAD_FAILED',
    CONFIG_VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',
    
    // Connection errors
    TCP_CONNECTION_FAILED: 'TCP_CONNECTION_FAILED',
    SERIAL_CONNECTION_FAILED: 'SERIAL_CONNECTION_FAILED',
    CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
    
    // Relay errors
    RELAY_TIMEOUT: 'RELAY_TIMEOUT',
    DATA_RELAY_FAILED: 'DATA_RELAY_FAILED',
    
    // Application errors
    APP_STARTUP_FAILED: 'APP_STARTUP_FAILED',
    SHUTDOWN_ERROR: 'SHUTDOWN_ERROR'
  };
  
  // Default configuration values
  const DEFAULTS = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000,
    CONNECTION_TIMEOUT: 10000,
    RELAY_TIMEOUT: 30000,
    BUFFER_SIZE: 1024,
    LOG_LEVEL: 'info'
  };
  
  // Serial port settings
  const SERIAL_SETTINGS = {
    PARITY: {
      NONE: 'none',
      EVEN: 'even',
      ODD: 'odd',
      MARK: 'mark',
      SPACE: 'space'
    },
    DATA_BITS: [5, 6, 7, 8],
    STOP_BITS: [1, 1.5, 2],
    FLOW_CONTROL: {
      NONE: false,
      HARDWARE: 'hardware',
      SOFTWARE: 'software'
    }
  };
  
  /**
   * Type definitions for JSDoc
   */
  
  /**
   * @typedef {Object} ConnectionConfig
   * @property {string} tcpIp - TCP server IP address
   * @property {number} tcpPort - TCP server port
   * @property {string} serialPath - Serial port path
   * @property {number} serialBaud - Serial baud rate
   * @property {string} serialParity - Serial parity setting
   * @property {number} serialDataBits - Serial data bits
   * @property {number} serialStopBits - Serial stop bits
   * @property {number} maxRetries - Maximum connection retries
   * @property {number} retryDelay - Delay between retries
   * @property {number} connectionTimeout - Connection timeout
   * @property {number} relayTimeout - Relay operation timeout
   */
  
  /**
   * @typedef {Object} ConnectionStats
   * @property {boolean} isConnected - Connection status
   * @property {boolean} isConnecting - Connecting status
   * @property {number} connectionAttempts - Number of connection attempts
   * @property {number} totalBytesReceived - Total bytes received
   * @property {number} totalBytesSent - Total bytes sent
   */
  
  /**
   * @typedef {Object} RelayStats
   * @property {boolean} isRunning - Relay running status
   * @property {boolean} dataRelayed - Whether data has been relayed
   * @property {number} duration - Relay duration in milliseconds
   * @property {number} totalBytesTransferred - Total bytes transferred
   * @property {ConnectionStats} tcp - TCP connection stats
   * @property {ConnectionStats} serial - Serial connection stats
   */
  
  /**
   * @typedef {Object} DataMetadata
   * @property {string} source - Data source ('tcp' or 'serial')
   * @property {number} bytes - Number of bytes
   * @property {string} hex - Hexadecimal representation
   * @property {string} ascii - ASCII representation
   */
  
  /**
   * @typedef {Object} StatusInfo
   * @property {string} runTimestamp - Run start timestamp
   * @property {boolean} success - Operation success status
   * @property {string} message - Status message
   * @property {string|null} error - Error message if any
   * @property {Object} connections - Connection status object
   * @property {Object} metrics - Performance metrics
   * @property {number} duration - Operation duration
   */
  
  module.exports = {
    CONNECTION_STATES,
    RELAY_DIRECTIONS,
    LOG_LEVELS,
    EVENT_TYPES,
    ERROR_CODES,
    DEFAULTS,
    SERIAL_SETTINGS
  };