// src/app.js
require('dotenv').config();

const { logger } = require('./utils/logger');
const { loadConfig, updateConfig } = require('./config');
const { shutdown, updateStatus, onShutdown, getStatus, setConfig, setUpdateConfigFunc } = require('./utils/status-manager');
const { getDeviceInfo } = require('./utils/device-info');
const RelayService = require('./services/relay-service');

/**
 * Main application class
 */
class TcpSerialRelayApp {
  constructor() {
    this.config = null;
    this.relayService = null;
    this.startTime = new Date();
  }

  /**
   * Initialize and run the application
   */
  async run() {
    try {
      logger.info('Starting TCP-Serial/TCP Relay Application', {
        startTime: this.startTime.toISOString(),
        processId: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        deviceInfo: getDeviceInfo()
      });

      // Load configuration
      await this.loadConfiguration();

      // Log connection mode
      const connectionMode = this.config.connectionType === 'tcp' ? 'TCP-to-TCP' : 'TCP-to-Serial';
      logger.info(`Operating in ${connectionMode} relay mode`);

      // Initialize relay service
      await this.initializeRelayService();

      // Setup shutdown handler
      this.setupShutdownHandler();

      // Start the relay service
      await this.startRelayService();

    } catch (error) {
      logger.error('Application startup failed', { 
        error: error.message,
        stack: error.stack 
      });
      await shutdown(false, `Startup failed: ${error.message}`, 1);
    }
  }

  /**
   * Load and validate configuration
   */
  async loadConfiguration() {
    logger.info('Loading application configuration...');
    updateStatus({ message: 'Loading configuration...' });

    try {
      this.config = await loadConfig();
      
      // Pass the config to the status manager for log collection
      setConfig(this.config);
      
      // Pass the updateConfig function to the status manager
      setUpdateConfigFunc(updateConfig);
      
      const logData = {
        connectionType: this.config.connectionType
      };

      if (this.config.connectionType === 'tcp') {
        logData.primaryTcp = `${this.config.tcpIp}:${this.config.tcpPort}`;
        logData.secondaryTcp = `${this.config.secondaryTcpIp}:${this.config.secondaryTcpPort}`;
      } else {
        logData.tcpEndpoint = `${this.config.tcpIp}:${this.config.tcpPort}`;
        logData.serialPort = this.config.serialPath;
        logData.serialBaud = this.config.serialBaud;
      }

      logger.info('Configuration loaded successfully', logData);
    } catch (error) {
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  /**
   * Initialize the relay service
   */
  async initializeRelayService() {
    logger.info('Initializing relay service...');
    updateStatus({ message: 'Initializing relay service...' });

    try {
      this.relayService = new RelayService(this.config);
      this.setupRelayEventHandlers();
      logger.info('Relay service initialized successfully');
    } catch (error) {
      throw new Error(`Relay service initialization failed: ${error.message}`);
    }
  }

  /**
   * Setup event handlers for the relay service
   */
  setupRelayEventHandlers() {
    // Relay service started
    this.relayService.on('started', () => {
      const connectionMode = this.config.connectionType === 'tcp' ? 'TCP-to-TCP' : 'TCP-to-Serial';
      logger.info(`${connectionMode} relay service started successfully`);
      updateStatus({ 
        message: 'Relay service running - waiting for data...',
        success: false // Will be true once data is relayed
      });
    });

    // Data successfully relayed
    this.relayService.on('dataRelayed', (info) => {
      logger.info('Data relayed successfully to TCP', info);
      // Update metrics are handled in RelayService
    });

    // Relay error occurred
    this.relayService.on('relayError', (info) => {
      logger.error('Data relay error', info);
    });

    // Client disconnected
    this.relayService.on('clientDisconnected', (info) => {
      logger.warn(`${info.clientName} client disconnected`, info);
    });

    // Relay completed successfully
    this.relayService.on('completed', async (result) => {
      logger.info('Relay operation completed', result);
      await shutdown(result.success, result.reason, 0);
    });

    // Relay timed out
    this.relayService.on('timeout', async (result) => {
      logger.warn('Relay operation timed out', result);
      await shutdown(result.success, result.reason, 0);
    });

    // Relay stopped (usually due to disconnection)
    this.relayService.on('stopped', async (result) => {
      logger.info('Relay service stopped', result);
      await shutdown(result.success, result.stats ? 'Service stopped after operation' : 'Service stopped unexpectedly', 0);
    });
  }

  /**
   * Setup shutdown handler for the relay service
   */
  setupShutdownHandler() {
    onShutdown(async (finalStatus) => {
      if (this.relayService) {
        logger.info('Shutting down relay service...');
        try {
          await this.relayService.stop();
          logger.info('Relay service shutdown completed');
        } catch (error) {
          logger.error('Error during relay service shutdown', { error: error.message });
        }
      }
    });
  }

  /**
   * Start the relay service
   */
  async startRelayService() {
    logger.info('Starting relay service...');
    updateStatus({ message: 'Starting relay service...' });

    try {
      await this.relayService.start();
      logger.info('Application initialization completed successfully');
    } catch (error) {
      throw new Error(`Failed to start relay service: ${error.message}`);
    }
  }

  /**
   * Get application health status
   */
  getHealthStatus() {
    return {
      uptime: Date.now() - this.startTime.getTime(),
      relayService: this.relayService?.getHealthStatus() || null,
      config: this.config ? {
        connectionType: this.config.connectionType,
        ...(this.config.connectionType === 'tcp' ? {
          primaryTcp: `${this.config.tcpIp}:${this.config.tcpPort}`,
          secondaryTcp: `${this.config.secondaryTcpIp}:${this.config.secondaryTcpPort}`
        } : {
          tcpEndpoint: `${this.config.tcpIp}:${this.config.tcpPort}`,
          serialPort: this.config.serialPath
        })
      } : null
    };
  }
}



/**
 * Main entry point
 */
async function main() {
  const app = new TcpSerialRelayApp();
  await app.run();
}

// Handle unhandled promise rejections and exceptions at the module level
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString()
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Run the application if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal application error:', error);
    process.exit(1);
  });
}

module.exports = { TcpSerialRelayApp, main };