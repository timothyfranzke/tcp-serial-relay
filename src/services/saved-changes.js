// src/services/secondary-tcp-client.js
const net = require('net');
const EventEmitter = require('events');
const { logger, dataLogger } = require('../utils/logger');
const { createConnectionRetryHandler } = require('../utils/retry-handler');

/**
 * Secondary TCP Client for TCP-to-TCP relay functionality
 * This client connects to a secondary TCP server when connectionType is 'tcp'
 */
class SecondaryTcpClient extends EventEmitter {
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
    this.lastHeartbeatTime = 0;
    this.heartbeatInterval = null;
    this.reconnectInProgress = false;
  }

  /**
   * Connect to secondary TCP server
   * @returns {Promise} Promise that resolves when connected
   */
  async connect() {
    if (this.isConnected) {
      logger.debug('Secondary TCP client already connected');
      return;
    }

    if (this.isConnecting) {
      logger.debug('Secondary TCP connection already in progress');
      return;
    }

    logger.info('Initiating secondary TCP connection', {
      host: this.config.secondaryTcpIp,
      port: this.config.secondaryTcpPort
    });

    try {
      await this.retryHandler.execute(
        async (attempt) => {
          this.connectionAttempts = attempt;
          return this.attemptConnection();
        },
        'Secondary TCP connection',
        {
          host: this.config.secondaryTcpIp,
          port: this.config.secondaryTcpPort
        }
      );
      
      // Start heartbeat after successful connection
      this.startHeartbeat();
      
      return;
    } catch (error) {
      logger.error('All connection attempts failed', {
        error: error.message,
        host: this.config.secondaryTcpIp,
        port: this.config.secondaryTcpPort
      });
      throw error;
    }
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
        this.reconnectInProgress = false;
        this.socket.setTimeout(0); // Disable timeout once connected
        this.lastHeartbeatTime = Date.now();
        
        logger.info('Secondary TCP connection established', {
          host: this.config.secondaryTcpIp,
          port: this.config.secondaryTcpPort,
          localAddress: this.socket.localAddress,
          localPort: this.socket.localPort,
          attempts: this.connectionAttempts,
          socketState: this.getSocketState()
        });
        
        this.emit('connected', {
          host: this.config.secondaryTcpIp,
          port: this.config.secondaryTcpPort,
          attempts: this.connectionAttempts
        });
        
        resolve();
      });
      
      // Connection timeout handler
      this.socket.on('timeout', () => {
        this.cleanup();
        const error = new Error(`Secondary TCP connection timeout to ${this.config.secondaryTcpIp}:${this.config.secondaryTcpPort}`);
        logger.warn('Secondary TCP connection timeout', {
          host: this.config.secondaryTcpIp,
          port: this.config.secondaryTcpPort,
          timeoutMs: this.config.connectionTimeout || 10000
        });
        reject(error);
      });
      
      // Connection error handler
      this.socket.on('error', (error) => {
        this.cleanup();
        logger.warn('Secondary TCP connection error', {
          host: this.config.secondaryTcpIp,
          port: this.config.secondaryTcpPort,
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
      this.socket.connect(this.config.secondaryTcpPort, this.config.secondaryTcpIp);
    });
  }

  /**
   * Handle incoming data from secondary TCP connection
   * @param {Buffer} data - Received data
   */
  handleIncomingData(data) {
    this.totalBytesReceived += data.length;
    
    const dataHex = data.toString('hex');
    const dataAscii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
    
    logger.debug('Secondary TCP data received', {
      bytes: data.length,
      hex: dataHex,
      totalReceived: this.totalBytesReceived
    });
    
    if (this.config.logDataTransfers) {
      dataLogger.silly(`SECONDARY_TCP->RELAY: ${data.length} bytes | HEX: ${dataHex} | ASCII: ${dataAscii}`);
    }
    
    this.emit('data', data, {
      source: 'secondary-tcp',
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
    
    logger.warn('Secondary TCP connection closed', {
      hadError,
      wasConnected,
      host: this.config.secondaryTcpIp,
      port: this.config.secondaryTcpPort,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent
    });
    
    this.emit('disconnected', {
      hadError,
      wasConnected,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent
    });
    
    // Stop heartbeat on disconnection
    this.stopHeartbeat();
  }

  /**
   * Get current socket state for diagnostics
   * @returns {object} Socket state information
   */
  getSocketState() {
    if (!this.socket) {
      return { exists: false };
    }
    
    return {
      exists: true,
      destroyed: this.socket.destroyed,
      writable: this.socket.writable,
      connecting: this.socket.connecting,
      pending: this.socket.pending,
      readyState: this.socket.readyState
    };
  }
  
  /**
   * Start heartbeat to verify connection
   */
  startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing heartbeat
    
    // Set up heartbeat interval (every 10 seconds by default)
    const heartbeatIntervalMs = this.config.heartbeatInterval || 10000;
    
    this.heartbeatInterval = setInterval(() => {
      this.checkConnection();
    }, heartbeatIntervalMs);
    
    logger.debug('Started secondary TCP heartbeat', { intervalMs: heartbeatIntervalMs });
  }
  
  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.debug('Stopped secondary TCP heartbeat');
    }
  }
  
  /**
   * Check if connection is still valid
   */
  checkConnection() {
    if (!this.isConnected || !this.socket) {
      logger.debug('Heartbeat detected disconnected state');
      return;
    }
    
    const socketState = this.getSocketState();
    
    // If socket is destroyed or not writable, connection is invalid
    if (socketState.destroyed || !socketState.writable) {
      logger.warn('Heartbeat detected invalid socket state', { socketState });
      this.handleDisconnection(false);
      return;
    }
    
    // Update last heartbeat time
    this.lastHeartbeatTime = Date.now();
    logger.debug('Secondary TCP heartbeat successful', { socketState });
  }
  
  /**
   * Reconnect to secondary TCP server
   * @returns {Promise} Promise that resolves when reconnected
   */
  async reconnect() {
    if (this.reconnectInProgress) {
      logger.debug('Reconnection already in progress');
      return;
    }
    
    this.reconnectInProgress = true;
    logger.info('Attempting to reconnect to secondary TCP server');
    
    // Clean up existing connection
    this.cleanup();
    
    try {
      // Attempt to connect again
      await this.connect();
      logger.info('Successfully reconnected to secondary TCP server');
      return true;
    } catch (error) {
      logger.error('Failed to reconnect to secondary TCP server', { error: error.message });
      this.reconnectInProgress = false;
      throw error;
    }
  }

  /**
   * Send data through secondary TCP connection
   * @param {Buffer} data - Data to send
   * @returns {Promise} Promise that resolves when data is sent
   */
  async send(data) {
    // Enhanced connection verification
    if (!this.isConnected || !this.socket || this.socket.destroyed || !this.socket.writable) {
      const socketState = this.getSocketState();
      logger.warn('Secondary TCP client not in valid state for sending', { socketState });
      
      // Try to reconnect if socket is in invalid state
      try {
        logger.info('Attempting reconnection before sending data');
        await this.reconnect();
      } catch (reconnectError) {
        throw new Error(`Secondary TCP client reconnection failed: ${reconnectError.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => {
        if (error) {
          logger.error('Secondary TCP send error', {
            error: error.message,
            code: error.code,
            socketState: this.getSocketState(),
            dataLength: data.length
          });
          
          // Attempt to reconnect and resend on error
          this.reconnect().then(() => {
            logger.info('Reconnected, retrying data send');
            return this.send(data);
          }).then(resolve).catch(reject);
        } else {
          this.totalBytesSent += data.length;
          this.lastHeartbeatTime = Date.now(); // Update heartbeat time on successful send
          
          const dataHex = data.toString('hex');
          const dataAscii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
          
          logger.debug('Secondary TCP data sent', {
            bytes: data.length,
            hex: dataHex,
            totalSent: this.totalBytesSent,
            socketState: this.getSocketState()
          });
          
          if (this.config.logDataTransfers) {
            dataLogger.silly(`RELAY->SECONDARY_TCP: ${data.length} bytes | HEX: ${dataHex} | ASCII: ${dataAscii}`);
          }
          
          this.emit('dataSent', data, {
            destination: 'secondary-tcp',
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
   * Clean up resources
   */
  cleanup() {
    this.isConnected = false;
    this.isConnecting = false;
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    if (this.socket) {
      // Remove all listeners to prevent memory leaks
      this.socket.removeAllListeners();
      
      try {
        this.socket.destroy();
      } catch (error) {
        logger.debug('Error destroying socket', { error: error.message });
      }
      
      this.socket = null;
    }
  }

  /**
   * Close secondary TCP connection
   * @returns {Promise} Promise that resolves when closed
   */
  async close() {
    logger.info('Closing secondary TCP connection');
    
    return new Promise((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        this.cleanup();
        resolve();
        return;
      }
      
      this.socket.once('close', () => {
        this.cleanup();
        logger.info('Secondary TCP connection closed');
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
        host: this.config.secondaryTcpIp,
        port: this.config.secondaryTcpPort
      }
    };
  }
}

module.exports = SecondaryTcpClient;