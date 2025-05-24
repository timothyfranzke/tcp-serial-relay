// src/services/relay-service.js
const EventEmitter = require('events');
const { logger } = require('../utils/logger');
const { updateStatus, updateConnection, incrementMetric, registerConnection } = require('../utils/status-manager');
const TcpClient = require('./tcp-client');
const SerialClient = require('./serial-client');

/**
 * Main relay service that coordinates TCP and Serial connections
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
    logger.info('Starting TCP-Serial relay service', {
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

      // Setup event handlers
      this.setupEventHandlers();

      // Connect both clients
      await this.connectClients();

      // Setup data relay
      this.setupDataRelay();

      // Start relay timeout
      this.startRelayTimeout();

      this.isRunning = true;
      updateStatus({ 
        message: 'Relay service running and waiting for data...',
        connections: {
          tcp: this.tcpClient.getStats(),
          serial: this.serialClient.getStats()
        }
      });

      logger.info('Relay service started successfully', {
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
   * Connect both TCP and Serial clients
   * @returns {Promise} Promise that resolves when both are connected
   */
  async connectClients() {
    logger.info('Connecting to TCP and Serial endpoints...');

    // Connect TCP client
    updateStatus({ message: 'Connecting to TCP server...' });
    await this.tcpClient.connect();
    updateConnection('tcp', { 
      connected: true, 
      ...this.tcpClient.getStats() 
    });

    // Connect Serial client
    updateStatus({ message: 'Connecting to Serial port...' });
    await this.serialClient.connect();
    updateConnection('serial', { 
      connected: true, 
      ...this.serialClient.getStats() 
    });

    logger.info('Both connections established successfully');
    incrementMetric('totalConnections');
  }

  /**
   * Setup event handlers for both clients
   */
  setupEventHandlers() {
    // TCP Client events
    this.tcpClient.on('connected', (info) => {
      logger.info('TCP client connected', info);
      updateConnection('tcp', { connected: true, ...info });
    });

    this.tcpClient.on('disconnected', (info) => {
      logger.warn('TCP client disconnected', info);
      updateConnection('tcp', { connected: false, ...info });
      this.handleDisconnection('tcp', info);
    });

    this.tcpClient.on('data', (data, metadata) => {
      this.handleDataFromTcp(data, metadata);
    });

    // Serial Client events
    this.serialClient.on('connected', (info) => {
      logger.info('Serial client connected', info);
      updateConnection('serial', { connected: true, ...info });
    });

    this.serialClient.on('disconnected', (info) => {
      logger.warn('Serial client disconnected', info);
      updateConnection('serial', { connected: false, ...info });
      this.handleDisconnection('serial', info);
    });

    this.serialClient.on('data', (data, metadata) => {
      this.handleDataFromSerial(data, metadata);
    });
  }

  /**
   * Setup bidirectional data relay
   */
  setupDataRelay() {
    logger.info('Setting up bidirectional data relay');
    
    // Data relay is handled by the event handlers
    // tcpClient 'data' event -> handleDataFromTcp -> serialClient.send
    // serialClient 'data' event -> handleDataFromSerial -> tcpClient.send
  }

  /**
   * Handle data received from TCP client
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
        dataLength: data.length
      });
      incrementMetric('errors');
      this.emit('relayError', {
        direction: 'tcp-to-serial',
        error: error.message,
        data
      });
    }
  }

  /**
   * Handle data received from Serial client
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
        dataLength: data.length
      });
      incrementMetric('errors');
      this.emit('relayError', {
        direction: 'serial-to-tcp',
        error: error.message,
        data
      });
    }
  }

  /**
   * Handle client disconnection
   * @param {string} clientType - Type of client that disconnected
   * @param {object} info - Disconnection info
   */
  handleDisconnection(clientType, info) {
    logger.warn(`${clientType} client disconnected`, info);
    
    updateConnection(clientType, { connected: false, ...info });
    
    this.emit('clientDisconnected', {
      clientType,
      info,
      hadDataRelay: this.dataRelayed
    });

    // If either client disconnects, stop the relay
    if (this.isRunning) {
      const message = `${clientType} connection lost${this.dataRelayed ? ' after successful data relay' : ' before data relay'}`;
      this.emit('stopped', {
        success: this.dataRelayed,
        reason: message
      });
    }
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
          serialConnected: this.serialClient?.isConnected
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
   * Stop the relay service
   * @returns {Promise} Promise that resolves when stopped
   */
  async stop() {
    if (!this.isRunning) {
      logger.debug('Relay service is not running');
      return;
    }

    logger.info('Stopping relay service...');
    this.isRunning = false;

    // Clear timeout
    if (this.relayTimeout) {
      clearTimeout(this.relayTimeout);
      this.relayTimeout = null;
    }

    const stopPromises = [];

    // Close TCP client
    if (this.tcpClient) {
      stopPromises.push(
        this.tcpClient.close().catch(error => {
          logger.warn('Error closing TCP client', { error: error.message });
        })
      );
    }

    // Close Serial client
    if (this.serialClient) {
      stopPromises.push(
        this.serialClient.close().catch(error => {
          logger.warn('Error closing Serial client', { error: error.message });
        })
      );
    }

    // Wait for all connections to close
    await Promise.all(stopPromises);

    const finalStats = this.getStats();
    
    logger.info('Relay service stopped', {
      dataRelayed: this.dataRelayed,
      duration: finalStats.duration,
      totalBytesTransferred: finalStats.totalBytesTransferred
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
      uptime: this.startTime ? Date.now() - this.startTime : 0,
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