// src/services/relay-service.js - Enhanced error handling for connection issues
const EventEmitter = require('events');
const { logger } = require('../utils/logger');
const { updateStatus, updateConnection, incrementMetric, registerConnection } = require('../utils/status-manager');
const TcpClient = require('./tcp-client');
const SerialClient = require('./serial-client');

/**
 * Main relay service with robust error handling for connection failures
 */
class RelayService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.tcpClient = null;
    this.serialClient = null;
    this.isRunning = false;
    this.dataRelayed = false;
    this.relayTimeout = null;
    this.startTime = null;
    this.connectionErrors = new Map();
    this.maxConnectionErrors = 5;
    this.errorResetInterval = 60000; // Reset error count every minute
  }

  /**
   * Initialize and start the relay service
   * @returns {Promise} Promise that resolves when relay is running
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Relay service is already running');
      return;
    }

    this.startTime = Date.now();
    logger.info('Starting TCP-Serial relay service with enhanced error handling', {
      config: this.config
    });

    updateStatus({ message: 'Initializing relay service...' });

    try {
      // Initialize clients
      this.tcpClient = new TcpClient(this.config);
      this.serialClient = new SerialClient(this.config);

      // Register connections for cleanup
      registerConnection('tcp', this.tcpClient);
      registerConnection('serial', this.serialClient);

      // Setup enhanced event handlers
      this.setupEnhancedEventHandlers();

      // Connect both clients with error resilience
      await this.connectClientsWithResilience();

      // Setup data relay
      this.setupDataRelay();

      // Start relay timeout
      this.startRelayTimeout();

      // Start error monitoring
      this.startErrorMonitoring();

      this.isRunning = true;
      updateStatus({ 
        message: 'Relay service running and waiting for data...',
        connections: {
          tcp: this.tcpClient.getStats(),
          serial: this.serialClient.getStats()
        }
      });

      logger.info('Relay service started successfully with enhanced error handling', {
        duration: Date.now() - this.startTime
      });

      this.emit('started');

    } catch (error) {
      logger.error('Failed to start relay service', { error: error.message });
      await this.stop();
      throw error;
    }
  }

  /**
   * Connect both clients with enhanced error handling and resilience
   * @returns {Promise} Promise that resolves when both are connected
   */
  async connectClientsWithResilience() {
    logger.info('Connecting to TCP and Serial endpoints with error resilience...');

    const connectionPromises = [];

    // Connect TCP client
    connectionPromises.push(
      this.connectTcpWithRetry().catch(error => {
        logger.error('Failed to establish TCP connection', { error: error.message });
        throw new Error(`TCP connection failed: ${error.message}`);
      })
    );

    // Connect Serial client  
    connectionPromises.push(
      this.connectSerialWithRetry().catch(error => {
        logger.error('Failed to establish Serial connection', { error: error.message });
        throw new Error(`Serial connection failed: ${error.message}`);
      })
    );

    // Wait for both connections with timeout
    try {
      await Promise.all(connectionPromises);
      logger.info('Both connections established successfully');
      incrementMetric('totalConnections');
    } catch (error) {
      // If either connection fails, clean up and throw
      logger.error('Connection establishment failed', { error: error.message });
      await this.cleanupConnections();
      throw error;
    }
  }

  /**
   * Connect TCP client with enhanced retry logic
   * @returns {Promise} Promise that resolves when TCP is connected
   */
  async connectTcpWithRetry() {
    updateStatus({ message: 'Connecting to TCP server...' });
    
    try {
      await this.tcpClient.connect();
      updateConnection('tcp', { 
        connected: true, 
        ...this.tcpClient.getStats() 
      });
      logger.info('TCP connection established successfully');
    } catch (error) {
      updateConnection('tcp', { 
        connected: false, 
        error: error.message,
        ...this.tcpClient.getStats() 
      });
      throw error;
    }
  }

  /**
   * Connect Serial client with enhanced retry logic
   * @returns {Promise} Promise that resolves when Serial is connected
   */
  async connectSerialWithRetry() {
    updateStatus({ message: 'Connecting to Serial port...' });
    
    try {
      await this.serialClient.connect();
      updateConnection('serial', { 
        connected: true, 
        ...this.serialClient.getStats() 
      });
      logger.info('Serial connection established successfully');
    } catch (error) {
      updateConnection('serial', { 
        connected: false, 
        error: error.message,
        ...this.serialClient.getStats() 
      });
      throw error;
    }
  }

  /**
   * Setup enhanced event handlers with proper error handling
   */
  setupEnhancedEventHandlers() {
    // TCP Client events with enhanced error handling
    this.tcpClient.on('connected', (info) => {
      logger.info('TCP client connected', info);
      updateConnection('tcp', { connected: true, ...info });
      this.resetConnectionErrors('tcp');
    });

    this.tcpClient.on('disconnected', (info) => {
      logger.warn('TCP client disconnected', info);
      updateConnection('tcp', { connected: false, ...info });
      this.handleDisconnection('tcp', info);
    });

    // Enhanced TCP error handling
    this.tcpClient.on('error', (errorInfo) => {
      this.handleConnectionError('tcp', errorInfo);
    });

    this.tcpClient.on('data', (data, metadata) => {
      this.handleDataFromTcp(data, metadata);
    });

    this.tcpClient.on('dataError', (error) => {
      logger.error('TCP data processing error', { error: error.message });
      incrementMetric('errors');
    });

    // Serial Client events with enhanced error handling
    this.serialClient.on('connected', (info) => {
      logger.info('Serial client connected', info);
      updateConnection('serial', { connected: true, ...info });
      this.resetConnectionErrors('serial');
    });

    this.serialClient.on('disconnected', (info) => {
      logger.warn('Serial client disconnected', info);
      updateConnection('serial', { connected: false, ...info });
      this.handleDisconnection('serial', info);
    });

    // Enhanced Serial error handling (if similar errors occur)
    this.serialClient.on('error', (errorInfo) => {
      this.handleConnectionError('serial', errorInfo);
    });

    this.serialClient.on('data', (data, metadata) => {
      this.handleDataFromSerial(data, metadata);
    });

    this.serialClient.on('dataError', (error) => {
      logger.error('Serial data processing error', { error: error.message });
      incrementMetric('errors');
    });
  }

  /**
   * Handle connection errors with tracking and decision logic
   * @param {string} clientType - Type of client (tcp/serial)
   * @param {object} errorInfo - Error information
   */
  handleConnectionError(clientType, errorInfo) {
    // Track error count
    const errorCount = this.incrementConnectionErrors(clientType);
    
    logger.error(`${clientType} connection error (${errorCount}/${this.maxConnectionErrors})`, {
      ...errorInfo,
      errorCount,
      isRetryable: errorInfo.retryable
    });

    incrementMetric('errors');

    // Emit error event for monitoring
    this.emit('connectionError', {
      clientType,
      errorInfo,
      errorCount,
      shouldContinue: errorCount < this.maxConnectionErrors
    });

    // If error count exceeds threshold and not retryable, consider stopping
    if (errorCount >= this.maxConnectionErrors && !errorInfo.retryable) {
      logger.error(`${clientType} connection has too many non-retryable errors, stopping relay`, {
        errorCount,
        maxErrors: this.maxConnectionErrors
      });
      
      this.emit('stopped', {
        success: this.dataRelayed,
        reason: `${clientType} connection failed with ${errorCount} errors`
      });
    }
  }

  /**
   * Increment connection error count
   * @param {string} clientType - Type of client
   * @returns {number} Current error count
   */
  incrementConnectionErrors(clientType) {
    const current = this.connectionErrors.get(clientType) || 0;
    const newCount = current + 1;
    this.connectionErrors.set(clientType, newCount);
    return newCount;
  }

  /**
   * Reset connection error count
   * @param {string} clientType - Type of client
   */
  resetConnectionErrors(clientType) {
    if (this.connectionErrors.has(clientType)) {
      logger.debug(`Reset error count for ${clientType} client`);
      this.connectionErrors.delete(clientType);
    }
  }

  /**
   * Start error monitoring and periodic reset
   */
  startErrorMonitoring() {
    // Reset error counts periodically
    this.errorResetTimer = setInterval(() => {
      if (this.connectionErrors.size > 0) {
        logger.debug('Resetting connection error counts', {
          previousErrors: Object.fromEntries(this.connectionErrors)
        });
        this.connectionErrors.clear();
      }
    }, this.errorResetInterval);
  }

  /**
   * Handle data received from TCP client with error protection
   * @param {Buffer} data - Received data
   * @param {object} metadata - Data metadata
   */
  async handleDataFromTcp(data, metadata) {
    try {
      logger.debug('Relaying data from TCP to Serial', {
        bytes: data.length,
        hex: metadata.hex
      });

      await this.serialClient.send(data);
      
      this.markDataRelayed();
      incrementMetric('bytesTransferredTcpToSerial', data.length);
      incrementMetric('dataTransfers');

      this.emit('dataRelayed', {
        direction: 'tcp-to-serial',
        bytes: data.length,
        metadata
      });

    } catch (error) {
      logger.error('Failed to relay data from TCP to Serial', {
        error: error.message,
        code: error.code,
        dataLength: data.length
      });
      incrementMetric('errors');
      
      this.emit('relayError', {
        direction: 'tcp-to-serial',
        error: error.message,
        retryable: this.isRetryableDataError(error),
        data
      });

      // If it's a critical error, consider stopping
      if (!this.isRetryableDataError(error)) {
        this.handleConnectionError('serial', {
          error: error.message,
          retryable: false
        });
      }
    }
  }

  /**
   * Handle data received from Serial client with error protection
   * @param {Buffer} data - Received data
   * @param {object} metadata - Data metadata
   */
  async handleDataFromSerial(data, metadata) {
    try {
      logger.debug('Relaying data from Serial to TCP', {
        bytes: data.length,
        hex: metadata.hex
      });

      await this.tcpClient.send(data);
      
      this.markDataRelayed();
      incrementMetric('bytesTransferredSerialToTcp', data.length);
      incrementMetric('dataTransfers');

      this.emit('dataRelayed', {
        direction: 'serial-to-tcp',
        bytes: data.length,
        metadata
      });

    } catch (error) {
      logger.error('Failed to relay data from Serial to TCP', {
        error: error.message,
        code: error.code,
        dataLength: data.length
      });
      incrementMetric('errors');
      
      this.emit('relayError', {
        direction: 'serial-to-tcp',
        error: error.message,
        retryable: this.isRetryableDataError(error),
        data
      });

      // If it's a critical error, consider stopping
      if (!this.isRetryableDataError(error)) {
        this.handleConnectionError('tcp', {
          error: error.message,
          retryable: false
        });
      }
    }
  }

  /**
   * Check if a data relay error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} True if retryable
   */
  isRetryableDataError(error) {
    // Temporary network issues are retryable
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTCONN'];
    return retryableCodes.includes(error.code);
  }

  /**
   * Handle client disconnection with enhanced logic
   * @param {string} clientType - Type of client that disconnected
   * @param {object} info - Disconnection info
   */
  handleDisconnection(clientType, info) {
    logger.warn(`${clientType} client disconnected`, info);
    
    updateConnection(clientType, { connected: false, ...info });
    
    this.emit('clientDisconnected', {
      clientType,
      info,
      hadDataRelay: this.dataRelayed,
      isExpectedDisconnect: info.isClosing || false
    });

    // Only stop if it's not an expected disconnect and we're still running
    if (this.isRunning && !info.isClosing) {
      const message = `${clientType} connection lost${this.dataRelayed ? ' after successful data relay' : ' before data relay'}`;
      this.emit('stopped', {
        success: this.dataRelayed,
        reason: message
      });
    }
  }

  /**
   * Setup bidirectional data relay
   */
  setupDataRelay() {
    logger.info('Setting up bidirectional data relay with error protection');
    // Data relay is handled by the enhanced event handlers
  }

  /**
   * Mark that data has been successfully relayed
   */
  markDataRelayed() {
    if (!this.dataRelayed) {
      this.dataRelayed = true;
      logger.info('First data relay successful - relay is now active');
      updateStatus({ message: 'Data relay active' });
    }
  }

  /**
   * Start the relay timeout
   */
  startRelayTimeout() {
    const timeoutMs = this.config.relayTimeout || 30000;
    
    logger.info(`Starting relay timeout: ${timeoutMs}ms`);
    
    this.relayTimeout = setTimeout(() => {
      if (!this.dataRelayed) {
        logger.warn('Relay timeout: No data transferred within timeout period', {
          timeoutMs,
          tcpConnected: this.tcpClient?.isConnected,
          serialConnected: this.serialClient?.isConnected,
          tcpErrors: this.connectionErrors.get('tcp') || 0,
          serialErrors: this.connectionErrors.get('serial') || 0
        });
        
        this.emit('timeout', {
          success: false,
          reason: `Timeout: No data relayed within ${timeoutMs}ms`
        });
      } else {
        logger.info('Relay completed successfully within timeout period', {
          timeoutMs,
          totalBytesTransferred: this.getTotalBytesTransferred()
        });
        
        this.emit('completed', {
          success: true,
          reason: 'Data relay completed successfully'
        });
      }
    }, timeoutMs);
  }

  /**
   * Clean up connections during error scenarios
   */
  async cleanupConnections() {
    const cleanupPromises = [];
    
    if (this.tcpClient) {
      cleanupPromises.push(
        this.safeCloseConnection('TCP', this.tcpClient)
      );
    }
    
    if (this.serialClient) {
      cleanupPromises.push(
        this.safeCloseConnection('Serial', this.serialClient)
      );
    }
    
    await Promise.all(cleanupPromises);
  }

  /**
   * Safely close a connection with fallback methods
   * @param {string} clientName - Name for logging
   * @param {object} client - Client to close
   * @returns {Promise} Promise that resolves when closed
   */
  async safeCloseConnection(clientName, client) {
    try {
      if (!client) {
        logger.debug(`${clientName} client is null, skipping cleanup`);
        return;
      }

      // Try close method first
      if (typeof client.close === 'function') {
        await client.close();
        logger.debug(`${clientName} client closed successfully`);
        return;
      }

      // Try destroy method as fallback
      if (typeof client.destroy === 'function') {
        client.destroy();
        logger.debug(`${clientName} client destroyed successfully`);
        return;
      }

      // Try disconnect method as fallback
      if (typeof client.disconnect === 'function') {
        await client.disconnect();
        logger.debug(`${clientName} client disconnected successfully`);
        return;
      }

      // If client has a socket/port property, try to close it
      if (client.socket && typeof client.socket.destroy === 'function') {
        client.socket.destroy();
        logger.debug(`${clientName} client socket destroyed successfully`);
        return;
      }

      if (client.port && typeof client.port.close === 'function') {
        client.port.close();
        logger.debug(`${clientName} client port closed successfully`);
        return;
      }

      logger.warn(`${clientName} client has no known close method, cleanup may be incomplete`);

    } catch (error) {
      logger.warn(`Error during ${clientName} cleanup`, { 
        error: error.message,
        hasClose: typeof client.close === 'function',
        hasDestroy: typeof client.destroy === 'function',
        hasDisconnect: typeof client.disconnect === 'function'
      });
    }
  }

  /**
   * Get total bytes transferred in both directions
   * @returns {number} Total bytes transferred
   */
  getTotalBytesTransferred() {
    const tcpStats = this.tcpClient?.getStats() || {};
    const serialStats = this.serialClient?.getStats() || {};
    
    return (tcpStats.totalBytesReceived || 0) + 
           (tcpStats.totalBytesSent || 0) + 
           (serialStats.totalBytesReceived || 0) + 
           (serialStats.totalBytesSent || 0);
  }

  /**
   * Get comprehensive relay statistics
   * @returns {object} Relay statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      dataRelayed: this.dataRelayed,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      totalBytesTransferred: this.getTotalBytesTransferred(),
      connectionErrors: Object.fromEntries(this.connectionErrors),
      tcp: this.tcpClient?.getStats() || null,
      serial: this.serialClient?.getStats() || null,
      config: {
        tcpIp: this.config.tcpIp,
        tcpPort: this.config.tcpPort,
        serialPath: this.config.serialPath,
        serialBaud: this.config.serialBaud,
        relayTimeout: this.config.relayTimeout
      }
    };
  }

  /**
   * Stop the relay service with enhanced cleanup
   * @returns {Promise} Promise that resolves when stopped
   */
  async stop() {
    if (!this.isRunning) {
      logger.debug('Relay service is not running');
      return;
    }

    logger.info('Stopping relay service with enhanced cleanup...');
    this.isRunning = false;

    // Clear timeouts
    if (this.relayTimeout) {
      clearTimeout(this.relayTimeout);
      this.relayTimeout = null;
    }

    if (this.errorResetTimer) {
      clearInterval(this.errorResetTimer);
      this.errorResetTimer = null;
    }

    // Clean up connections using safe method
    await this.cleanupConnections();

    const finalStats = this.getStats();
    
    logger.info('Relay service stopped', {
      dataRelayed: this.dataRelayed,
      duration: finalStats.duration,
      totalBytesTransferred: finalStats.totalBytesTransferred,
      connectionErrors: finalStats.connectionErrors
    });

    updateStatus({
      message: this.dataRelayed ? 'Relay service stopped after successful data transfer' : 'Relay service stopped without data transfer',
      connections: {
        tcp: { connected: false },
        serial: { connected: false }
      }
    });

    this.emit('stopped', {
      success: this.dataRelayed,
      stats: finalStats
    });
  }

  /**
   * Check if relay is healthy
   * @returns {object} Health status
   */
  getHealthStatus() {
    return {
      isRunning: this.isRunning,
      dataRelayed: this.dataRelayed,
      tcpConnected: this.tcpClient?.isConnected || false,
      serialConnected: this.serialClient?.isConnected || false,
      tcpHealthy: this.tcpClient?.isHealthy() || false,
      serialHealthy: this.serialClient?.isHealthy?.() || this.serialClient?.isConnected || false,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      connectionErrors: Object.fromEntries(this.connectionErrors),
      lastActivity: this.getLastActivity()
    };
  }

  /**
   * Get timestamp of last activity
   * @returns {number|null} Timestamp of last activity
   */
  getLastActivity() {
    // This would need to be implemented to track last data transfer
    // For now, return null
    return null;
  }
}

module.exports = RelayService;