// src/services/relay-service.js
const EventEmitter = require('events');
const https = require('https');
const { logger } = require('../utils/logger');
const { updateStatus, updateConnection, incrementMetric, registerConnection } = require('../utils/status-manager');
const TcpClient = require('./tcp-client');
const SerialClient = require('./serial-client');
const SecondaryTcpClient = require('./secondary-tcp-client');
const { getDeviceId } = require('../utils/device-info');

/**
 * Main relay service that coordinates TCP and Serial/TCP connections
 */
class RelayService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.tcpClient = null;
    this.secondaryClient = null; // Can be either SerialClient or SecondaryTcpClient
    this.isRunning = false;
    this.dataRelayed = false;
    this.relayTimeout = null;
    this.startTime = null;
    this.sentMacAddress = false;
    this.secondaryDataBuffer = []; // Buffer to collect data from secondary client
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
    logger.info('Starting TCP-Serial/TCP relay service', {
      config: this.getSafeConfigForLogging()
    });

    updateStatus({ message: 'Initializing relay service...' });

    try {
      // Initialize clients
      this.tcpClient = new TcpClient(this.config);
      
      // Initialize secondary client based on connection type
      if (this.config.connectionType === 'tcp') {
        this.secondaryClient = new SecondaryTcpClient(this.config);
        logger.info('Configured for TCP-to-TCP relay mode');
      } else {
        this.secondaryClient = new SerialClient(this.config);
        logger.info('Configured for TCP-to-Serial relay mode');
      }

      // Register connections for cleanup
      registerConnection('tcp', this.tcpClient);
      registerConnection('secondary', this.secondaryClient);

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
          secondary: this.secondaryClient.getStats()
        }
      });

      logger.info('Relay service started successfully - here', {
        duration: Date.now() - this.startTime,
        connectionType: this.config.connectionType
      });

      this.emit('started');

    } catch (error) {
      logger.error('Failed to start relay service', { error: error.message });
      await this.stop();
      throw error;
    }
  }

  /**
   * Get safe config for logging (without sensitive data)
   */
  getSafeConfigForLogging() {
    const safeConfig = {
      tcpIp: this.config.tcpIp,
      tcpPort: this.config.tcpPort,
      connectionType: this.config.connectionType
    };

    if (this.config.connectionType === 'serial') {
      safeConfig.serialPath = this.config.serialPath;
      safeConfig.serialBaud = this.config.serialBaud;
    } else if (this.config.connectionType === 'tcp') {
      safeConfig.secondaryTcpIp = this.config.secondaryTcpIp;
      safeConfig.secondaryTcpPort = this.config.secondaryTcpPort;
    }

    return safeConfig;
  }

  /**
   * Connect both TCP and Secondary clients
   * @returns {Promise} Promise that resolves when both are connected
   */
  async connectClients() {
    const secondaryType = this.config.connectionType === 'tcp' ? 'secondary TCP' : 'Serial';
    logger.info(`Connecting to TCP and ${secondaryType} endpoints...`);

    // Connect TCP client
    updateStatus({ message: 'Connecting to TCP server...' });
    await this.tcpClient.connect();
    updateConnection('tcp', { 
      connected: true, 
      ...this.tcpClient.getStats() 
    });

    // Connect Secondary client
    updateStatus({ message: `Connecting to ${secondaryType} endpoint...` });
    await this.secondaryClient.connect();
    updateConnection('secondary', { 
      connected: true, 
      ...this.secondaryClient.getStats() 
    });

    logger.info('Both connections established successfully');
    incrementMetric('totalConnections');
  }

  /**
   * Setup event handlers for both clients
   */
  setupEventHandlers() {
    const secondaryType = this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial';

    // TCP Client events
    this.tcpClient.on('connected', (info) => {
      
      logger.info('TCP client connected', info);
      const deviceId = getDeviceId();
      logger.info(`Sending MAC address to TCP server: ${deviceId}`);
      this.tcpClient.send(deviceId);
      updateConnection('tcp', { connected: true, ...info });
    });

    this.tcpClient.on('disconnected', (info) => {
      logger.warn('TCP client disconnected', info);
      updateConnection('tcp', { connected: false, ...info });
      this.handleDisconnection('tcp', info);
    });

    this.tcpClient.on('data', (data, metadata) => {
      console.log('TCP data received', {
        bytes: data.length,
        hex: metadata.hex
      });
      this.handleDataFromTcp(data, metadata);
    });

    // Secondary Client events
    this.secondaryClient.on('connected', (info) => {
      logger.info(`${secondaryType} client connected`, info);
      updateConnection('secondary', { connected: true, ...info });
    });

    this.secondaryClient.on('disconnected', (info) => {
      logger.warn(`${secondaryType} client disconnected`, info);
      updateConnection('secondary', { connected: false, ...info });
      this.handleDisconnection('secondary', info);
    });

    this.secondaryClient.on('data', (data, metadata) => {
      console.log('Secondary data received', {
        bytes: data.length,
        hex: metadata.hex
      });
      // Store data in buffer
      this.secondaryDataBuffer.push({
        timestamp: new Date().toISOString(),
        data: data.toString('hex'),
        length: data.length,
        metadata
      });
      
      if (!this.sentMacAddress) {
        this.sentMacAddress = true;
        // add mac address to data
        const deviceId = getDeviceId() + '\n';
        // data = Buffer.from(deviceId) + data;
      }
      this.handleDataFromSecondary(data, metadata);
    });
  }

  /**
   * Setup bidirectional data relay
   */
  setupDataRelay() {
    const secondaryType = this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial';
    logger.info(`Setting up bidirectional data relay (TCP <-> ${secondaryType})`);
    
    // Data relay is handled by the event handlers
    // tcpClient 'data' event -> handleDataFromTcp -> secondaryClient.send
    // secondaryClient 'data' event -> handleDataFromSecondary -> tcpClient.send
  }

  /**
   * Handle data received from TCP client
   * @param {Buffer} data - Received data
   * @param {object} metadata - Data metadata
   */
  async handleDataFromTcp(data, metadata) {
    try {
      const destinationType = this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial';
      logger.debug(`Relaying data from TCP to ${destinationType}`, {
        bytes: data.length,
        hex: metadata.hex
      });

      await this.secondaryClient.send(data);
      
      this.markDataRelayed();
      
      const metricName = this.config.connectionType === 'tcp' ? 
        'bytesTransferredTcpToSecondaryTcp' : 'bytesTransferredTcpToSerial';
      incrementMetric(metricName, data.length);
      incrementMetric('dataTransfers');

      this.emit('dataRelayed', {
        direction: this.config.connectionType === 'tcp' ? 'tcp-to-secondary-tcp' : 'tcp-to-serial',
        bytes: data.length,
        metadata
      });

    } catch (error) {
      const destinationType = this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial';
      logger.error(`Failed to relay data from TCP to ${destinationType}`, {
        error: error.message,
        dataLength: data.length
      });
      incrementMetric('errors');
      this.emit('relayError', {
        direction: this.config.connectionType === 'tcp' ? 'tcp-to-secondary-tcp' : 'tcp-to-serial',
        error: error.message,
        data
      });
    }
  }

  /**
   * Handle data received from Secondary client (Serial or TCP)
   * @param {Buffer} data - Received data
   * @param {object} metadata - Data metadata
   */
  async handleDataFromSecondary(data, metadata) {
    try {
      const sourceType = this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial';
      logger.debug(`Relaying data from ${sourceType} to TCP`, {
        bytes: data.length,
        hex: metadata.hex
      });

      await this.tcpClient.send(data);
      
      this.markDataRelayed();
      
      const metricName = this.config.connectionType === 'tcp' ? 
        'bytesTransferredSecondaryTcpToTcp' : 'bytesTransferredSerialToTcp';
      incrementMetric(metricName, data.length);
      incrementMetric('dataTransfers');

      this.emit('dataRelayed', {
        direction: this.config.connectionType === 'tcp' ? 'secondary-tcp-to-tcp' : 'serial-to-tcp',
        bytes: data.length,
        metadata
      });

    } catch (error) {
      const sourceType = this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial';
      logger.error(`Failed to relay data from ${sourceType} to TCP`, {
        error: error.message,
        dataLength: data.length
      });
      incrementMetric('errors');
      this.emit('relayError', {
        direction: this.config.connectionType === 'tcp' ? 'secondary-tcp-to-tcp' : 'serial-to-tcp',
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
    const clientName = clientType === 'tcp' ? 'TCP' : 
      (this.config.connectionType === 'tcp' ? 'Secondary TCP' : 'Serial');
    
    logger.warn(`${clientName} client disconnected`, info);
    
    updateConnection(clientType, { connected: false, ...info });
    
    this.emit('clientDisconnected', {
      clientType,
      clientName,
      info,
      hadDataRelay: this.dataRelayed
    });

    // If either client disconnects, stop the relay
    if (this.isRunning) {
      const message = `${clientName} connection lost${this.dataRelayed ? ' after successful data relay' : ' before data relay'}`;
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
          secondaryConnected: this.secondaryClient?.isConnected
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
    const secondaryStats = this.secondaryClient?.getStats() || {};
    
    return (tcpStats.totalBytesReceived || 0) + 
           (tcpStats.totalBytesSent || 0) + 
           (secondaryStats.totalBytesReceived || 0) + 
           (secondaryStats.totalBytesSent || 0);
  }

  /**
   * Get comprehensive relay statistics
   * @returns {object} Relay statistics
   */
  getStats() {
    const connectionType = this.config.connectionType;
    
    return {
      isRunning: this.isRunning,
      dataRelayed: this.dataRelayed,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      totalBytesTransferred: this.getTotalBytesTransferred(),
      connectionType: connectionType,
      tcp: this.tcpClient?.getStats() || null,
      secondary: this.secondaryClient?.getStats() || null,
      config: this.getSafeConfigForLogging()
    };
  }

  /**
   * Get timestamp of last activity
   * @returns {number|null} Timestamp of last activity
   */
  getLastActivity() {
    const tcpLastActivity = this.tcpClient?.getLastActivity() || 0;
    const secondaryLastActivity = this.secondaryClient?.getLastActivity() || 0;
    
    if (tcpLastActivity === 0 && secondaryLastActivity === 0) {
      return null;
    }
    
    return Math.max(tcpLastActivity, secondaryLastActivity);
  }

  /**
   * Post collected data to the device data endpoint
   * @returns {Promise<boolean>} Success status
   */
  async postDataToEndpoint() {
    if (this.secondaryDataBuffer.length === 0) {
      logger.info('No secondary data to post to endpoint');
      return false;
    }

    const deviceId = getDeviceId();
    
    // Combine all data into a single string (hex format)
    const combinedData = this.secondaryDataBuffer.map(packet => packet.data).join('');
    
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        deviceId,
        data: combinedData
      });
      
      const options = {
        hostname: 'us-central1-tcp-gateway-26246.cloudfunctions.net',
        path: '/deviceData',
        port: 443,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };
      
      logger.info('Posting collected data to endpoint', { 
        endpoint: 'https://us-central1-tcp-gateway-26246.cloudfunctions.net/deviceData',
        deviceId,
        dataSize: combinedData.length,
        packetCount: this.secondaryDataBuffer.length
      });
      
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            logger.info('Data successfully posted to endpoint', { 
              statusCode: res.statusCode,
              response: responseData.substring(0, 100) // Log only first 100 chars
            });
            resolve(true);
          } else {
            logger.warn('Failed to post data to endpoint', { 
              statusCode: res.statusCode,
              response: responseData.substring(0, 100)
            });
            resolve(false);
          }
        });
      });
      
      req.on('error', (error) => {
        logger.error('Error posting data to endpoint', { error: error.message });
        resolve(false);
      });
      
      req.setTimeout(10000, () => {
        logger.warn('Data posting request timed out');
        req.abort();
        resolve(false);
      });
      
      req.write(postData);
      req.end();
    });
  }

  /**
   * Output the collected data from the secondary client buffer
   */
  outputSecondaryDataBuffer() {
    if (this.secondaryDataBuffer.length === 0) {
      logger.info('No secondary data was collected in the buffer');
      return;
    }

    logger.info(`Outputting collected secondary data (${this.secondaryDataBuffer.length} packets):`);
    
    // Calculate total bytes
    const totalBytes = this.secondaryDataBuffer.reduce((sum, item) => sum + item.length, 0);
    
    console.log('===== SECONDARY DATA BUFFER SUMMARY =====');
    console.log(`Total packets: ${this.secondaryDataBuffer.length}`);
    console.log(`Total bytes: ${totalBytes}`);
    console.log('\nPacket details:');
    
    // Output each packet
    this.secondaryDataBuffer.forEach((packet, index) => {
      console.log(`\nPacket #${index + 1}:`);
      console.log(`  Timestamp: ${packet.timestamp}`);
      console.log(`  Length: ${packet.length} bytes`);
      console.log(`  Data (hex): ${packet.data}`);
      if (packet.metadata && packet.metadata.ascii) {
        console.log(`  Data (ascii): ${packet.metadata.ascii}`);
      }
    });
    
    console.log('\n===== END OF SECONDARY DATA BUFFER =====');
  }

  /**
   * Stop the relay service
   * @returns {Promise} Promise that resolves when stopped
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('Relay service is not running');
      return;
    }

    logger.info('Stopping relay service');

    // Output collected secondary data
    this.outputSecondaryDataBuffer();
    
    // Post data to endpoint if collectData is enabled
    if (this.config.collectData === true) {
      logger.info('Data collection is enabled, posting data to endpoint');
      await this.postDataToEndpoint();
    }
    
    // Clear the buffer after posting
    this.secondaryDataBuffer = [];

    // Clear timeout
    if (this.relayTimeout) {
      clearTimeout(this.relayTimeout);
      this.relayTimeout = null;
    }

    // Close connections
    try {
      if (this.tcpClient) {
        await this.tcpClient.close();
      }

      if (this.secondaryClient) {
        await this.secondaryClient.close();
      }
    } catch (error) {
      logger.error('Error closing connections', { error: error.message });
    }

    this.isRunning = false;
    logger.info('Relay service stopped', {
      dataRelayed: this.dataRelayed,
      duration: finalStats.duration,
      totalBytesTransferred: finalStats.totalBytesTransferred,
      connectionType: this.config.connectionType
    });

    updateStatus({
      message: this.dataRelayed ? 'Relay service stopped after successful data transfer' : 'Relay service stopped without data transfer',
      connections: {
        tcp: { connected: false },
        secondary: { connected: false }
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
      connectionType: this.config.connectionType,
      tcpConnected: this.tcpClient?.isConnected || false,
      secondaryConnected: this.secondaryClient?.isConnected || false,
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