// src/services/serial-client.js - Enhanced with missing methods and better error handling
const EventEmitter = require('events');
const { logger, dataLogger } = require('../utils/logger');
const { createConnectionRetryHandler } = require('../utils/retry-handler');

/**
 * Serial Client with automatic reconnection, event-based communication, and enhanced error handling
 */
class SerialClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.port = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isClosing = false;
    this.retryHandler = createConnectionRetryHandler({
      maxRetries: config.maxRetries || 3,
      baseDelay: config.retryDelay || 2000
    });
    this.connectionAttempts = 0;
    this.totalBytesReceived = 0;
    this.totalBytesSent = 0;
    this.lastError = null;
    this.SerialPort = null;
    
    this.setupSerialPort();
  }

  /**
   * Setup SerialPort class based on environment
   */
  setupSerialPort() {
    try {
      if (process.env.MOCK_ENV === 'true') {
        logger.info('Using mock SerialPort for testing');
        const serialportModule = require('serialport');
        const { MockBinding } = require('@serialport/binding-mock');
        this.SerialPort = serialportModule.SerialPort;
        this.SerialPort.Binding = MockBinding;
        
        // Create mock port for testing
        MockBinding.createPort(this.config.serialPath, { echo: true, record: true });
      } else {
        const serialportModule = require('serialport');
        this.SerialPort = serialportModule.SerialPort;
      }
    } catch (error) {
      logger.error('Failed to setup SerialPort', { 
        error: error.message,
        mockEnv: process.env.MOCK_ENV 
      });
      throw new Error(`SerialPort setup failed: ${error.message}`);
    }
  }

  /**
   * Connect to serial port
   * @returns {Promise} Promise that resolves when connected
   */
  async connect() {
    if (this.isConnected) {
      logger.debug('Serial client already connected');
      return;
    }

    if (this.isConnecting) {
      logger.debug('Serial connection already in progress');
      return;
    }

    logger.info('Initiating Serial connection', {
      path: this.config.serialPath,
      baudRate: this.config.serialBaud,
      settings: {
        parity: this.config.serialParity,
        dataBits: this.config.serialDataBits,
        stopBits: this.config.serialStopBits
      }
    });

    return this.retryHandler.execute(
      async (attempt) => {
        this.connectionAttempts = attempt;
        return this.attemptConnection();
      },
      'Serial connection',
      {
        path: this.config.serialPath,
        baudRate: this.config.serialBaud
      }
    );
  }

  /**
   * Attempt a single connection
   * @returns {Promise} Promise that resolves when connected
   */
  // src/services/serial-client.js - Enhanced error handling section
// Add this method to the SerialClient class:

/**
 * Enhanced connection attempt with better error propagation
 */
attemptConnection() {
  return new Promise((resolve, reject) => {
    this.isConnecting = true;
    this.lastError = null;
    
    try {
      // Create new SerialPort instance
      this.port = new this.SerialPort({
        path: this.config.serialPath,
        baudRate: this.config.serialBaud,
        parity: this.config.serialParity,
        dataBits: this.config.serialDataBits,
        stopBits: this.config.serialStopBits,
        autoOpen: false
      });
    } catch (error) {
      this.handleConnectionError(error);
      // CRITICAL: Reject the promise instead of just emitting
      reject(error);
      return;
    }
    
    // Connection success handler
    this.port.on('open', () => {
      this.isConnected = true;
      this.isConnecting = false;
      
      logger.info('Serial port opened successfully', {
        path: this.config.serialPath,
        baudRate: this.config.serialBaud,
        settings: {
          parity: this.config.serialParity,
          dataBits: this.config.serialDataBits,
          stopBits: this.config.serialStopBits
        },
        attempts: this.connectionAttempts
      });
      
      this.emit('connected', {
        path: this.config.serialPath,
        baudRate: this.config.serialBaud,
        attempts: this.connectionAttempts
      });
      
      resolve();
    });
    
    // Data received handler
    this.port.on('data', (data) => {
      this.handleIncomingData(data);
    });
    
    // ENHANCED: Better error handling that always rejects
    this.port.on('error', (error) => {
      this.handleConnectionError(error);
      
      // Emit for event listeners AND reject for promise chain
      this.emit('error', {
        error: error.message,
        code: error.code,
        retryable: this.isRetryableError(error),
        phase: 'connection'
      });
      
      // CRITICAL: Always reject on error during connection attempt
      if (this.isConnecting) {
        reject(error);
      }
    });
    
    // Close handler
    this.port.on('close', (hadError) => {
      this.handleDisconnection(hadError);
    });
    
    // Attempt to open the port with timeout
    const connectionTimeout = setTimeout(() => {
      const timeoutError = new Error(`Serial connection timeout after ${this.config.connectionTimeout || 10000}ms`);
      this.handleConnectionError(timeoutError);
      reject(timeoutError);
    }, this.config.connectionTimeout || 10000);
    
    try {
      this.port.open((error) => {
        clearTimeout(connectionTimeout);
        
        if (error) {
          this.handleConnectionError(error);
          reject(error);
        }
        // Success is handled by the 'open' event
      });
    } catch (error) {
      clearTimeout(connectionTimeout);
      this.handleConnectionError(error);
      reject(error);
    }
  });
}

  /**
   * Enhanced error handling to prevent uncaught exceptions
   * @param {Error} error - The error that occurred
   */
  handleConnectionError(error) {
    this.lastError = error;
    this.cleanup();
    
    // Determine error severity and type
    const errorInfo = {
      path: this.config.serialPath,
      baudRate: this.config.serialBaud,
      error: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      isSerialError: this.isSerialError(error),
      isPermissionError: this.isPermissionError(error)
    };

    if (this.isSerialError(error)) {
      logger.warn('Serial connection error (retryable)', errorInfo);
    } else if (this.isPermissionError(error)) {
      logger.error('Serial permission error (requires attention)', errorInfo);
    } else {
      logger.error('Serial unexpected error', errorInfo);
    }

    // Emit error event instead of letting it bubble up as uncaught
    this.emit('error', {
      ...errorInfo,
      retryable: this.isRetryableError(error)
    });
  }

  /**
   * Check if error is a serial-related error
   * @param {Error} error - Error to check
   * @returns {boolean} True if serial error
   */
  isSerialError(error) {
    const serialErrors = [
      'ENOENT',  // Port doesn't exist
      'EBUSY',   // Port is busy
      'EAGAIN',  // Resource temporarily unavailable
      'EIO'      // I/O error
    ];
    return serialErrors.includes(error.code) || 
           error.message.includes('No such file or directory') ||
           error.message.includes('Port is not open') ||
           error.message.includes('cannot open');
  }

  /**
   * Check if error is a permission-related error
   * @param {Error} error - Error to check
   * @returns {boolean} True if permission error
   */
  isPermissionError(error) {
    return error.code === 'EACCES' || 
           error.message.includes('Permission denied') ||
           error.message.includes('Access denied');
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    // Permission errors are not retryable, but device not found might be
    return this.isSerialError(error) && !this.isPermissionError(error);
  }

  /**
   * Handle incoming data from serial port
   * @param {Buffer} data - Received data
   */
  handleIncomingData(data) {
    try {
      this.totalBytesReceived += data.length;
      
      const dataHex = data.toString('hex');
      const dataAscii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
      
      logger.debug('Serial data received', {
        bytes: data.length,
        hex: dataHex,
        totalReceived: this.totalBytesReceived
      });
      
      if (this.config.logDataTransfers) {
        dataLogger.silly(`SERIAL->RELAY: ${data.length} bytes | HEX: ${dataHex} | ASCII: ${dataAscii}`);
      }
      
      this.emit('data', data, {
        source: 'serial',
        bytes: data.length,
        hex: dataHex,
        ascii: dataAscii
      });
    } catch (error) {
      logger.error('Error processing Serial data', {
        error: error.message,
        dataLength: data?.length || 0
      });
      this.emit('dataError', error);
    }
  }

  /**
   * Handle disconnection
   * @param {boolean} hadError - Whether disconnection was due to error
   */
  handleDisconnection(hadError) {
    const wasConnected = this.isConnected;
    
    logger.warn('Serial port closed', {
      hadError,
      wasConnected,
      isClosing: this.isClosing,
      path: this.config.serialPath,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent,
      lastError: this.lastError?.message
    });
    
    this.cleanup();
    
    this.emit('disconnected', {
      hadError,
      wasConnected,
      isClosing: this.isClosing,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent,
      lastError: this.lastError
    });
  }

  /**
   * Send data through serial port with error handling
   * @param {Buffer} data - Data to send
   * @returns {Promise} Promise that resolves when data is sent
   */
  async send(data) {
    if (!this.isConnected || !this.port || !this.port.isOpen) {
      throw new Error('Serial port not connected or not open');
    }

    return new Promise((resolve, reject) => {
      try {
        this.port.write(data, (error) => {
          if (error) {
            logger.error('Serial send error', {
              error: error.message,
              code: error.code,
              dataLength: data.length
            });
            reject(error);
          } else {
            this.totalBytesSent += data.length;
            
            const dataHex = data.toString('hex');
            const dataAscii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
            
            logger.debug('Serial data sent', {
              bytes: data.length,
              hex: dataHex,
              totalSent: this.totalBytesSent
            });
            
            if (this.config.logDataTransfers) {
              dataLogger.silly(`RELAY->SERIAL: ${data.length} bytes | HEX: ${dataHex} | ASCII: ${dataAscii}`);
            }
            
            this.emit('dataSent', data, {
              destination: 'serial',
              bytes: data.length,
              hex: dataHex,
              ascii: dataAscii
            });
            
            resolve();
          }
        });
      } catch (error) {
        logger.error('Serial send exception', {
          error: error.message,
          dataLength: data.length
        });
        reject(error);
      }
    });
  }

  /**
   * Clean up connection state
   */
  cleanup() {
    this.isConnected = false;
    this.isConnecting = false;
    
    if (this.port) {
      try {
        // Remove all listeners to prevent memory leaks
        this.port.removeAllListeners();
        
        if (this.port.isOpen) {
          this.port.close();
        }
      } catch (error) {
        logger.warn('Error during serial port cleanup', { 
          error: error.message 
        });
      } finally {
        this.port = null;
      }
    }
  }

  /**
   * Close serial connection gracefully
   * @returns {Promise} Promise that resolves when closed
   */
  async close() {
    if (this.isClosing) {
      logger.debug('Serial close already in progress');
      return;
    }

    this.isClosing = true;
    logger.info('Closing Serial connection gracefully');
    
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) {
        this.cleanup();
        resolve();
        return;
      }
      
      // Set up close handler
      const onClose = () => {
        this.cleanup();
        logger.info('Serial connection closed gracefully');
        resolve();
      };
      
      this.port.once('close', onClose);
      
      try {
        // Close the port
        this.port.close();
        
        // Force cleanup after timeout
        setTimeout(() => {
          this.cleanup();
          resolve();
        }, 3000);
        
      } catch (error) {
        logger.warn('Error during Serial close', { 
          error: error.message 
        });
        this.cleanup();
        resolve();
      }
    });
  }

  /**
   * Get connection statistics
   * @returns {object} Connection stats
   */
  getStats() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      isClosing: this.isClosing,
      connectionAttempts: this.connectionAttempts,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent,
      lastError: this.lastError?.message || null,
      config: {
        path: this.config.serialPath,
        baudRate: this.config.serialBaud,
        parity: this.config.serialParity,
        dataBits: this.config.serialDataBits,
        stopBits: this.config.serialStopBits
      }
    };
  }

  /**
   * Check if connection is healthy
   * @returns {boolean} True if connection is healthy
   */
  isHealthy() {
    return this.isConnected && 
           this.port && 
           this.port.isOpen;
  }

  /**
   * List available serial ports
   * @returns {Promise<Array>} Array of available ports
   */
  static async listPorts() {
    try {
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      logger.debug('Available serial ports', { ports });
      return ports;
    } catch (error) {
      logger.error('Failed to list serial ports', { error: error.message });
      throw error;
    }
  }
}

module.exports = SerialClient;