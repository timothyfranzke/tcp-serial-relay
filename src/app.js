// src/app.js - Enhanced version with proper error handling and status reporting
require('dotenv').config();

const { logger } = require('./utils/logger');
const { loadConfig, updateConfig } = require('./config');
const { shutdown, updateStatus, onShutdown, getStatus, setConfig, setUpdateConfigFunc } = require('./utils/status-manager');
const { getDeviceInfo } = require('./utils/device-info');
const RelayService = require('./services/relay-service');

/**
 * Main application class with enhanced error handling
 */
class TcpSerialRelayApp {
  constructor() {
    this.config = null;
    this.relayService = null;
    this.startTime = new Date();
    this.initializationCompleted = false;
  }

  /**
   * Initialize and run the application with comprehensive error handling
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

      // Load configuration with error handling
      await this.safeLoadConfiguration();

      // Log connection mode
      const connectionMode = this.config.connectionType === 'tcp' ? 'TCP-to-TCP' : 'TCP-to-Serial';
      logger.info(`Operating in ${connectionMode} relay mode`);

      // Initialize relay service with error handling
      await this.safeInitializeRelayService();

      // Setup shutdown handler
      this.setupShutdownHandler();

      // Start the relay service with error handling
      await this.safeStartRelayService();

      // Mark initialization as completed
      this.initializationCompleted = true;

    } catch (error) {
      logger.error('Application startup failed', { 
        error: error.message,
        stack: error.stack,
        initializationCompleted: this.initializationCompleted
      });
      
      // Ensure status is sent even on startup failure
      await this.handleFatalError(error, 'Startup failed');
    }
  }

  /**
   * Safely load configuration with proper error handling
   */
  async safeLoadConfiguration() {
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
      updateStatus({ message: 'Configuration loaded successfully' });
      
    } catch (error) {
      const configError = new Error(`Configuration loading failed: ${error.message}`);
      configError.originalError = error;
      configError.phase = 'configuration';
      throw configError;
    }
  }

  /**
   * Safely initialize the relay service with proper error handling
   */
  async safeInitializeRelayService() {
    logger.info('Initializing relay service...');
    updateStatus({ message: 'Initializing relay service...' });

    try {
      this.relayService = new RelayService(this.config);
      this.setupRelayEventHandlers();
      logger.info('Relay service initialized successfully');
      updateStatus({ message: 'Relay service initialized successfully' });
      
    } catch (error) {
      const serviceError = new Error(`Relay service initialization failed: ${error.message}`);
      serviceError.originalError = error;
      serviceError.phase = 'service_initialization';
      throw serviceError;
    }
  }

  /**
   * Safely start the relay service with proper error handling
   */
  async safeStartRelayService() {
    logger.info('Starting relay service...');
    updateStatus({ message: 'Starting relay service...' });

    try {
      await this.relayService.start();
      logger.info('Application initialization completed successfully');
      updateStatus({ message: 'Relay service started successfully - waiting for connections' });
      
    } catch (error) {
      const startError = new Error(`Failed to start relay service: ${error.message}`);
      startError.originalError = error;
      startError.phase = 'service_startup';
      throw startError;
    }
  }

  /**
   * Handle fatal errors with proper status reporting
   */
  async handleFatalError(error, context = 'Unknown error') {
    try {
      const errorMessage = `${context}: ${error.message}`;
      const errorDetails = {
        error: error.message,
        stack: error.stack,
        phase: error.phase || 'unknown',
        originalError: error.originalError?.message,
        initializationCompleted: this.initializationCompleted,
        context: context
      };

      logger.error('Fatal application error', errorDetails);
      
      // Update status with error information
      updateStatus({ 
        message: errorMessage,
        error: errorDetails,
        success: false
      });

      // Force shutdown with status reporting
      await shutdown(false, errorMessage, 1);
      
    } catch (shutdownError) {
      logger.error('Error during fatal error handling', { 
        shutdownError: shutdownError.message,
        originalError: error.message 
      });
      
      // Last resort: exit with error code
      process.exit(1);
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
      logger.info('Data relayed successfully', info);
      // Update metrics are handled in RelayService
    });

    // Relay error occurred
    this.relayService.on('relayError', (info) => {
      logger.error('Data relay error', info);
      // Don't exit on relay errors, let the service handle recovery
    });

    // Client disconnected
    this.relayService.on('clientDisconnected', (info) => {
      logger.warn(`${info.clientName} client disconnected`, info);
    });

    // Service errors that should trigger shutdown
    this.relayService.on('error', async (error) => {
      logger.error('Relay service error', { error: error.message, stack: error.stack });
      await this.handleFatalError(error, 'Relay service error');
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
      await shutdown(
        result.success, 
        result.stats ? 'Service stopped after operation' : 'Service stopped unexpectedly', 
        0
      );
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
   * Get application health status
   */
  getHealthStatus() {
    return {
      uptime: Date.now() - this.startTime.getTime(),
      initializationCompleted: this.initializationCompleted,
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
 * Enhanced main entry point with comprehensive error handling
 */
async function main() {
  const app = new TcpSerialRelayApp();
  
  try {
    await app.run();
  } catch (error) {
    // This catch should not be reached due to handleFatalError in run()
    // But it's a safety net for any unexpected errors
    logger.error('Unexpected error in main()', { 
      error: error.message, 
      stack: error.stack 
    });
    
    try {
      await shutdown(false, `Fatal error: ${error.message}`, 1);
    } catch (shutdownError) {
      logger.error('Failed to shutdown gracefully', { error: shutdownError.message });
      process.exit(1);
    }
  }
}

// Enhanced global error handlers that ensure status reporting
process.on('unhandledRejection', async (reason, promise) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  const errorStack = reason instanceof Error ? reason.stack : undefined;
  
  logger.error('Unhandled Promise Rejection', {
    reason: errorMessage,
    stack: errorStack,
    promise: promise.toString()
  });
  
  try {
    updateStatus({ 
      message: `Unhandled promise rejection: ${errorMessage}`,
      error: { reason: errorMessage, stack: errorStack },
      success: false
    });
    
    await shutdown(false, `Unhandled rejection: ${errorMessage}`, 1);
  } catch (shutdownError) {
    logger.error('Failed to handle unhandled rejection gracefully', { error: shutdownError.message });
    process.exit(1);
  }
});

process.on('uncaughtException', async (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  
  try {
    updateStatus({ 
      message: `Uncaught exception: ${error.message}`,
      error: { message: error.message, stack: error.stack },
      success: false
    });
    
    await shutdown(false, `Uncaught exception: ${error.message}`, 1);
  } catch (shutdownError) {
    logger.error('Failed to handle uncaught exception gracefully', { error: shutdownError.message });
    process.exit(1);
  }
});

// Enhanced warning handler for potential issues
process.on('warning', (warning) => {
  logger.warn('Process warning', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack
  });
});

// Run the application if this file is executed directly
if (require.main === module) {
  main().catch(async (error) => {
    console.error('Fatal application error (final catch):', error);
    
    try {
      // Last ditch effort to send status
      await shutdown(false, `Final catch: ${error.message}`, 1);
    } catch (finalError) {
      console.error('Complete failure:', finalError);
      process.exit(1);
    }
  });
}

module.exports = { TcpSerialRelayApp, main };