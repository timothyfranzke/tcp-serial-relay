// src/services/serial-client.js
const EventEmitter = require('events');
const { logger, dataLogger } = require('../utils/logger');
const { createConnectionRetryHandler } = require('../utils/retry-handler');

/**
 * Serial Client with automatic reconnection and event-based communication
 */
class SerialClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.port = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.retryHandler = createConnectionRetryHandler({
      maxRetries: config.maxRetries || 3,
      baseDelay: config.retryDelay || 2000
    });
    this.connectionAttempts = 0;
    this.totalBytesReceived = 0;
    this.totalBytesSent = 0;
    this.SerialPort = null;
    
    this.setupSerialPort();
  }

  /**
   * Setup SerialPort class based on environment
   */
  setupSerialPort() {
    if (process.env.MOCK_ENV === 'true') {
      logger.info('Using mock SerialPort for testing');
      const serialportModule = require('serialport');
      const { MockBinding } = require('@serialport/binding-mock');
      this.SerialPort = serialportModule.SerialPort;
      this.SerialPort.Binding = MockBinding;
    } else {
      const serialportModule = require('serialport');
      this.SerialPort = serialportModule.SerialPort;
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
  attemptConnection() {
    return new Promise((resolve, reject) => {
      this.isConnecting = true;
      
      // Create new SerialPort instance
      this.port = new this.SerialPort({
        path: this.config.serialPath,
        baudRate: this.config.serialBaud,
        parity: this.config.serialParity,
        dataBits: this.config.serialDataBits,
        stopBits: this.config.serialStopBits,
        autoOpen: false
      });
      
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
      
      // Error handler
      this.port.on('error', (error) => {
        this.cleanup();
        logger.warn('Serial port error', {
          path: this.config.serialPath,
          error: error.message,
          code: error.code
        });
        reject(error);
      });
      
      // Close handler
      this.port.on('close', (hadError) => {
        this.handleDisconnection(hadError);
      });
      
      // Attempt to open the port
      this.port.open((error) => {
        if (error) {
          this.cleanup();
          logger.warn('Failed to open serial port', {
            path: this.config.serialPath,
            error: error.message,
            code: error.code
          });
          reject(error);
        }
      });
    });
  }

  /**
   * Handle incoming data from serial port
   * @param {Buffer} data - Received data
   */
  handleIncomingData(data) {
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
  }

  /**
   * Handle disconnection
   * @param {boolean} hadError - Whether disconnection was due to error
   */
  handleDisconnection(hadError) {
    const wasConnected = this.isConnected;
    this.cleanup();
    
    logger.warn('Serial port closed', {
      hadError,
      wasConnected,
      path: this.config.serialPath,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent
    });
    
    this.emit('disconnected', {
      hadError,
      wasConnected,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent
    });
  }

  /**
   * Send data through serial port
   * @param {Buffer} data - Data to send
   * @returns {Promise} Promise that resolves when data is sent
   */
  async send(data) {
    if (!this.isConnected || !this.port || !this.port.isOpen) {
      throw new Error('Serial port not connected or not open');
    }

    return new Promise((resolve, reject) => {
      this.port.write(data, (error) => {
        if (error) {
          logger.error('Serial send error', {
            error: error.message,
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
    });
  }

  /**
   * Clean up connection state
   */
  cleanup() {
    this.isConnected = false;
    this.isConnecting = false;
    
    if (this.port) {
      this.port.removeAllListeners();
      if (this.port.isOpen) {
        try {
          this.port.close();
        } catch (error) {
          logger.warn('Error closing serial port', { error: error.message });
        }
      }
      this.port = null;
    }
  }

  /**
   * Close serial connection
   * @returns {Promise} Promise that resolves when closed
   */
  async close() {
    logger.info('Closing Serial connection');
    
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) {
        this.cleanup();
        resolve();
        return;
      }
      
      this.port.once('close', () => {
        this.cleanup();
        logger.info('Serial connection closed');
        resolve();
      });
      
      try {
        this.port.close();
      } catch (error) {
        logger.warn('Error during serial close', { error: error.message });
        this.cleanup();
        resolve();
      }
      
      // Force cleanup after timeout
      setTimeout(() => {
        this.cleanup();
        resolve();
      }, 5000);
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
      connectionAttempts: this.connectionAttempts,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent,
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