// src/services/tcp-client.js
const net = require('net');
const EventEmitter = require('events');
const { logger, dataLogger } = require('../utils/logger');
const { createConnectionRetryHandler } = require('../utils/retry-handler');

/**
 * TCP Client with automatic reconnection and event-based communication
 */
class TcpClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.retryHandler = createConnectionRetryHandler({
      maxRetries: config.maxRetries || 3,
      baseDelay: config.retryDelay || 2000
    });
    this.connectionAttempts = 0;
    this.totalBytesReceived = 0;
    this.totalBytesSent = 0;
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

    logger.info('Initiating TCP connection', {
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
        this.cleanup();
        const error = new Error(`TCP connection timeout to ${this.config.tcpIp}:${this.config.tcpPort}`);
        logger.warn('TCP connection timeout', {
          host: this.config.tcpIp,
          port: this.config.tcpPort,
          timeoutMs: this.config.connectionTimeout || 10000
        });
        reject(error);
      });
      
      // Connection error handler
      this.socket.on('error', (error) => {
        this.cleanup();
        logger.warn('TCP connection error', {
          host: this.config.tcpIp,
          port: this.config.tcpPort,
          error: error.message,
          code: error.code
        });
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
      this.socket.connect(this.config.tcpPort, this.config.tcpIp);
    });
  }

  /**
   * Handle incoming data from TCP connection
   * @param {Buffer} data - Received data
   */
  handleIncomingData(data) {
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
  }

  /**
   * Handle disconnection
   * @param {boolean} hadError - Whether disconnection was due to error
   */
  handleDisconnection(hadError) {
    const wasConnected = this.isConnected;
    this.cleanup();
    
    logger.warn('TCP connection closed', {
      hadError,
      wasConnected,
      host: this.config.tcpIp,
      port: this.config.tcpPort,
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
   * Send data through TCP connection
   * @param {Buffer} data - Data to send
   * @returns {Promise} Promise that resolves when data is sent
   */
  async send(data) {
    if (!this.isConnected || !this.socket) {
      throw new Error('TCP client not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => {
        if (error) {
          logger.error('TCP send error', {
            error: error.message,
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
    });
  }

  /**
   * Clean up connection state
   */
  cleanup() {
    this.isConnected = false;
    this.isConnecting = false;
    
    if (this.socket) {
      this.socket.removeAllListeners();
      if (!this.socket.destroyed) {
        this.socket.destroy();
      }
      this.socket = null;
    }
  }

  /**
   * Close TCP connection
   * @returns {Promise} Promise that resolves when closed
   */
  async close() {
    logger.info('Closing TCP connection');
    
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        this.cleanup();
        resolve();
        return;
      }
      
      this.socket.once('close', () => {
        this.cleanup();
        logger.info('TCP connection closed');
        resolve();
      });
      
      this.socket.end();
      
      // Force close after timeout
      setTimeout(() => {
        if (this.socket && !this.socket.destroyed) {
          this.socket.destroy();
        }
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
        host: this.config.tcpIp,
        port: this.config.tcpPort
      }
    };
  }
}

module.exports = TcpClient;