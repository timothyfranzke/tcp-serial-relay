// src/services/tcp-client.js - Enhanced error handling
const net = require('net');
const EventEmitter = require('events');
const { logger, dataLogger } = require('../utils/logger');
const { createConnectionRetryHandler } = require('../utils/retry-handler');

/**
 * TCP Client with automatic reconnection and robust error handling
 */
class TcpClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
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
  }

  /**
   * Connect to TCP server
   * @returns {Promise} Promise that resolves when connected
   */
  async connect() {
    if (this.isConnected) {
      logger.debug('TCP client already connected');
      return;
    }

    if (this.isConnecting) {
      logger.debug('TCP connection already in progress');
      return;
    }

    logger.info('Initiating the TCP connection yall - attempt ' + this.connectionAttempts, {
      host: this.config.tcpIp,
      port: this.config.tcpPort
    });

    return this.retryHandler.execute(
      async (attempt) => {
        this.connectionAttempts = attempt;
        return this.attemptConnection();
      },
      'TCP connection',
      {
        host: this.config.tcpIp,
        port: this.config.tcpPort
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
      this.lastError = null;
      
      // Create new socket
      this.socket = new net.Socket();
      
      // Set connection timeout
      this.socket.setTimeout(this.config.connectionTimeout || 10000);
      
      // Connection success handler
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.socket.setTimeout(0); // Disable timeout once connected
        
        logger.info('TCP connection established', {
          host: this.config.tcpIp,
          port: this.config.tcpPort,
          localAddress: this.socket.localAddress,
          localPort: this.socket.localPort,
          attempts: this.connectionAttempts
        });
        
        this.emit('connected', {
          host: this.config.tcpIp,
          port: this.config.tcpPort,
          attempts: this.connectionAttempts
        });
        
        resolve();
      });
      
      // Connection timeout handler
      this.socket.on('timeout', () => {
        const error = new Error(`TCP connection timeout to ${this.config.tcpIp}:${this.config.tcpPort}`);
        this.handleConnectionError(error);
        reject(error);
      });
      
      // Connection error handler - Enhanced to prevent uncaught exceptions
      this.socket.on('error', (error) => {
        this.handleConnectionError(error);
        reject(error);
      });
      
      // Data received handler
      this.socket.on('data', (data) => {
        this.handleIncomingData(data);
      });
      
      // Connection close handler
      this.socket.on('close', (hadError) => {
        this.handleDisconnection(hadError);
      });
      
      // Attempt connection
      try {
        this.socket.connect(this.config.tcpPort, this.config.tcpIp);
      } catch (error) {
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
      host: this.config.tcpIp,
      port: this.config.tcpPort,
      error: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      isConnectionError: this.isConnectionError(error),
      isNetworkError: this.isNetworkError(error)
    };

    if (this.isConnectionError(error)) {
      logger.warn('TCP connection error (retryable)', errorInfo);
    } else if (this.isNetworkError(error)) {
      logger.error('TCP network error (may require attention)', errorInfo);
    } else {
      logger.error('TCP unexpected error', errorInfo);
    }

    // Emit error event instead of letting it bubble up as uncaught
    this.emit('error', {
      ...errorInfo,
      retryable: this.isRetryableError(error)
    });
  }

  /**
   * Check if error is a connection-related error
   * @param {Error} error - Error to check
   * @returns {boolean} True if connection error
   */
  isConnectionError(error) {
    const connectionErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH'
    ];
    return connectionErrors.includes(error.code);
  }

  /**
   * Check if error is a network-related error
   * @param {Error} error - Error to check
   * @returns {boolean} True if network error
   */
  isNetworkError(error) {
    const networkErrors = [
      'ECONNRESET',
      'EPIPE',
      'ENOTCONN',
      'ESHUTDOWN'
    ];
    return networkErrors.includes(error.code);
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    // Most connection and some network errors are retryable
    return this.isConnectionError(error) || 
           ['ECONNRESET', 'ETIMEDOUT'].includes(error.code);
  }

  /**
   * Handle incoming data from TCP connection
   * @param {Buffer} data - Received data
   */
  handleIncomingData(data) {
    try {
      this.totalBytesReceived += data.length;
      
      const dataHex = data.toString('hex');
      const dataAscii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
      
      logger.debug('TCP data received', {
        bytes: data.length,
        hex: dataHex,
        totalReceived: this.totalBytesReceived
      });
      
      if (this.config.logDataTransfers) {
        dataLogger.silly(`TCP->RELAY: ${data.length} bytes | HEX: ${dataHex} | ASCII: ${dataAscii}`);
      }
      
      this.emit('data', data, {
        source: 'tcp',
        bytes: data.length,
        hex: dataHex,
        ascii: dataAscii
      });
    } catch (error) {
      logger.error('Error processing TCP data', {
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
    
    logger.warn('TCP connection closed', {
      hadError,
      wasConnected,
      isClosing: this.isClosing,
      host: this.config.tcpIp,
      port: this.config.tcpPort,
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
   * Send data through TCP connection with error handling
   * @param {Buffer} data - Data to send
   * @returns {Promise} Promise that resolves when data is sent
   */
  async send(data) {
    if (!this.isConnected || !this.socket) {
      throw new Error('TCP client not connected');
    }

    if (this.socket.destroyed || this.socket.readyState !== 'open') {
      throw new Error('TCP socket is not in a writable state');
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket.write(data, (error) => {
          if (error) {
            logger.error('TCP send error', {
              error: error.message,
              code: error.code,
              dataLength: data.length
            });
            reject(error);
          } else {
            this.totalBytesSent += data.length;
            
            const dataHex = data.toString('hex');
            const dataAscii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
            
            logger.debug('TCP data sent', {
              bytes: data.length,
              hex: dataHex,
              totalSent: this.totalBytesSent
            });
            
            if (this.config.logDataTransfers) {
              dataLogger.silly(`RELAY->TCP: ${data.length} bytes | HEX: ${dataHex} | ASCII: ${dataAscii}`);
            }
            
            this.emit('dataSent', data, {
              destination: 'tcp',
              bytes: data.length,
              hex: dataHex,
              ascii: dataAscii
            });
            
            resolve();
          }
        });
      } catch (error) {
        logger.error('TCP send exception', {
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
    
    if (this.socket) {
      try {
        // Remove all listeners to prevent memory leaks
        this.socket.removeAllListeners();
        
        if (!this.socket.destroyed) {
          this.socket.destroy();
        }
      } catch (error) {
        logger.warn('Error during socket cleanup', { 
          error: error.message 
        });
      } finally {
        this.socket = null;
      }
    }
  }

  /**
   * Close TCP connection gracefully
   * @returns {Promise} Promise that resolves when closed
   */
  async close() {
    if (this.isClosing) {
      logger.debug('TCP close already in progress');
      return;
    }

    this.isClosing = true;
    logger.info('Closing TCP connection gracefully');
    
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        this.cleanup();
        resolve();
        return;
      }
      
      // Set up close handler
      const onClose = () => {
        this.cleanup();
        logger.info('TCP connection closed gracefully');
        resolve();
      };
      
      this.socket.once('close', onClose);
      
      try {
        // Try graceful close first
        this.socket.end();
        
        // Force close after timeout
        setTimeout(() => {
          if (this.socket && !this.socket.destroyed) {
            logger.warn('TCP graceful close timeout, forcing close');
            this.socket.destroy();
          }
          this.cleanup();
          resolve();
        }, 3000);
        
      } catch (error) {
        logger.warn('Error during TCP close', { 
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
        host: this.config.tcpIp,
        port: this.config.tcpPort,
        timeout: this.config.connectionTimeout
      }
    };
  }

  /**
   * Check if connection is healthy
   * @returns {boolean} True if connection is healthy
   */
  isHealthy() {
    return this.isConnected && 
           this.socket && 
           !this.socket.destroyed && 
           this.socket.readyState === 'open';
  }
}

module.exports = TcpClient;