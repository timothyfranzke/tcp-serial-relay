// src/app.js - Enhanced with better error handling for connection issues
require('dotenv').config();

const { logger } = require('./utils/logger');
const { loadConfig } = require('./config');
const { shutdown, updateStatus, onShutdown } = require('./utils/status-manager');
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
    this.criticalErrorCount = 0;
    this.maxCriticalErrors = 3;
    this.isShuttingDown = false;
  }

  /**
   * Initialize and run the application
   */
  async run() {
    try {
      logger.info('Starting TCP-Serial Relay Application with enhanced error handling', {
        startTime: this.startTime.toISOString(),
        processId: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        deviceInfo: getDeviceInfo()
      });

      // Setup enhanced error handling at process level
      this.setupProcessErrorHandling();

      // Load configuration
      await this.loadConfiguration();

      // Initialize relay service
      await this.initializeRelayService();

      // Setup shutdown handler
      this.setupShutdownHandler();

      // Start the relay service
      await this.startRelayService();

    } catch (error) {
      await this.handleCriticalError('Application startup failed', error);
    }
  }

  /**
   * Setup enhanced process-level error handling
   */
  setupProcessErrorHandling() {
    // Handle uncaught exceptions
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', async (error) => {
      await this.handleUncaughtException(error);
    });

    // Handle unhandled promise rejections
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', async (reason, promise) => {
      await this.handleUnhandledRejection(reason, promise);
    });

    // Handle SIGTERM and SIGINT more gracefully
    ['SIGTERM', 'SIGINT'].forEach(signal => {
      process.removeAllListeners(signal);
      process.on(signal, async () => {
        logger.info(`Received ${signal}, initiating graceful shutdown...`);
        await this.gracefulShutdown(`${signal} received`, 0);
      });
    });
  }

  /**
   * Handle uncaught exceptions with better error categorization
   * @param {Error} error - The uncaught exception
   */
  async handleUncaughtException(error) {
    const errorInfo = {
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      stack: error.stack
    };

    // Categorize the error
    if (this.isNetworkError(error)) {
      logger.error('Uncaught network exception - attempting recovery', errorInfo);
      
      // Try to handle network errors gracefully
      if (!this.isShuttingDown && this.criticalErrorCount < this.maxCriticalErrors) {
        this.criticalErrorCount++;
        
        // If we have a relay service, try to restart connections
        if (this.relayService && this.relayService.isRunning) {
          try {
            logger.info('Attempting to recover from network error by restarting relay service');
            await this.relayService.stop();
            
            // Wait a bit before attempting restart
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Try to restart
            await this.relayService.start();
            logger.info('Successfully recovered from network error');
            return;
            
          } catch (recoveryError) {
            logger.error('Failed to recover from network error', {
              originalError: errorInfo,
              recoveryError: recoveryError.message
            });
          }
        }
      }
    }

    // If we can't recover or it's not a network error, shutdown
    await this.handleCriticalError('Uncaught exception', error, 1);
  }

  /**
   * Handle unhandled promise rejections
   * @param {any} reason - Rejection reason
   * @param {Promise} promise - The rejected promise
   */
  async handleUnhandledRejection(reason, promise) {
    const errorInfo = {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString(),
      isError: reason instanceof Error
    };

    // If it's a network-related promise rejection, try to handle it
    if (reason instanceof Error && this.isNetworkError(reason)) {
      logger.error('Unhandled network promise rejection - attempting recovery', errorInfo);
      
      if (!this.isShuttingDown && this.criticalErrorCount < this.maxCriticalErrors) {
        this.criticalErrorCount++;
        logger.warn(`Network promise rejection count: ${this.criticalErrorCount}/${this.maxCriticalErrors}`);
        
        // Don't immediately shutdown for network promise rejections
        // Let the relay service error handling deal with it
        return;
      }
    }

    logger.error('Unhandled Promise Rejection', errorInfo);
    await this.handleCriticalError('Unhandled promise rejection', reason, 1);
  }

  /**
   * Check if an error is network-related
   * @param {Error} error - Error to check
   * @returns {boolean} True if network error
   */
  isNetworkError(error) {
    if (!error || !error.code) return false;
    
    const networkErrorCodes = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EPIPE',
      'ENOTCONN',
      'ESHUTDOWN'
    ];
    
    return networkErrorCodes.includes(error.code);
  }

  /**
   * Handle critical errors that require shutdown
   * @param {string} context - Error context
   * @param {Error} error - The error
   * @param {number} exitCode - Exit code
   */
  async handleCriticalError(context, error, exitCode = 1) {
    if (this.isShuttingDown) {
      return; // Prevent recursive shutdown
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error(context, { 
      error: errorMessage,
      code: error?.code,
      stack: error?.stack,
      criticalErrorCount: this.criticalErrorCount
    });

    await this.gracefulShutdown(`${context}: ${errorMessage}`, exitCode);
  }

  /**
   * Perform graceful shutdown
   * @param {string} reason - Shutdown reason
   * @param {number} exitCode - Exit code
   */
  async gracefulShutdown(reason, exitCode = 0) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    
    try {
      logger.info('Initiating graceful application shutdown', { reason, exitCode });
      
      // Stop relay service first
      if (this.relayService) {
        try {
          await this.relayService.stop();
          logger.info('Relay service stopped during shutdown');
        } catch (error) {
          logger.warn('Error stopping relay service during shutdown', { 
            error: error.message 
          });
        }
      }

      // Call the status manager shutdown
      await shutdown(exitCode === 0, reason, exitCode);
      
    } catch (shutdownError) {
      logger.error('Error during graceful shutdown', { 
        error: shutdownError.message 
      });
      process.exit(exitCode);
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
      logger.info('Configuration loaded successfully', {
        tcpEndpoint: `${this.config.tcpIp}:${this.config.tcpPort}`,
        serialPort: this.config.serialPath,
        serialBaud: this.config.serialBaud
      });
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
   * Setup event handlers for the relay service with enhanced error handling
   */
  setupRelayEventHandlers() {
    // Relay service started
    this.relayService.on('started', () => {
      logger.info('Relay service started successfully');
      updateStatus({ 
        message: 'Relay service running - waiting for data...',
        success: false // Will be true once data is relayed
      });
      // Reset critical error count on successful start
      this.criticalErrorCount = 0;
    });

    // Data successfully relayed
    this.relayService.on('dataRelayed', (info) => {
      logger.info('Data relayed successfully', info);
      // Reset critical error count on successful data relay
      this.criticalErrorCount = 0;
    });

    // Enhanced connection error handling
    this.relayService.on('connectionError', async (errorEvent) => {
      logger.warn('Relay connection error event', errorEvent);
      
      if (!errorEvent.shouldContinue) {
        logger.error('Relay service has too many connection errors, shutting down');
        await this.gracefulShutdown('Too many connection errors', 1);
      }
    });

    // Relay error occurred
    this.relayService.on('relayError', (info) => {
      logger.error('Data relay error', info);
      
      if (!info.retryable) {
        this.criticalErrorCount++;
        logger.warn(`Critical relay error count: ${this.criticalErrorCount}/${this.maxCriticalErrors}`);
        
        if (this.criticalErrorCount >= this.maxCriticalErrors) {
          this.gracefulShutdown('Too many critical relay errors', 1);
        }
      }
    });

    // Client disconnected
    this.relayService.on('clientDisconnected', (info) => {
      logger.warn('Client disconnected', info);
      
      // If it's an unexpected disconnect, increment error count
      if (!info.isExpectedDisconnect) {
        this.criticalErrorCount++;
        logger.warn(`Unexpected disconnect count: ${this.criticalErrorCount}/${this.maxCriticalErrors}`);
      }
    });

    // Relay completed successfully
    this.relayService.on('completed', async (result) => {
      logger.info('Relay operation completed', result);
      await this.gracefulShutdown(result.reason, 0);
    });

    // Relay timed out
    this.relayService.on('timeout', async (result) => {
      logger.warn('Relay operation timed out', result);
      await this.gracefulShutdown(result.reason, 0);
    });

    // Relay stopped (usually due to disconnection)
    this.relayService.on('stopped', async (result) => {
      logger.info('Relay service stopped', result);
      const exitCode = result.success ? 0 : 1;
      const reason = result.stats ? 'Service stopped after operation' : 'Service stopped unexpectedly';
      await this.gracefulShutdown(reason, exitCode);
    });
  }

  /**
   * Setup shutdown handler for the relay service
   */
  setupShutdownHandler() {
    onShutdown(async (finalStatus) => {
      if (this.relayService && !this.isShuttingDown) {
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
      criticalErrorCount: this.criticalErrorCount,
      maxCriticalErrors: this.maxCriticalErrors,
      isShuttingDown: this.isShuttingDown,
      relayService: this.relayService?.getHealthStatus() || null,
      config: this.config ? {
        tcpEndpoint: `${this.config.tcpIp}:${this.config.tcpPort}`,
        serialPort: this.config.serialPath
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

// Export for use in other modules
module.exports = { TcpSerialRelayApp, main };

// Run the application if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal application error:', error);
    process.exit(1);
  });
}