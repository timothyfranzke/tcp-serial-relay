// src/utils/status-manager.js
const { logger, safeStringify, loggerInstance } = require('./logger');
const { getDeviceInfo, getDeviceId } = require('./device-info');
const https = require('https');
let config = null;
let updateConfigFunc = null;

// Function to set the config reference
function setConfig(configObj) {
  config = configObj;
  
  // Enable log collection if specified in config
  if (config && config.collectLogs === true) {
    loggerInstance.setCollectLogs(true);
    logger.info('Log collection enabled from configuration');
  }
}

// Function to set the updateConfig function reference
function setUpdateConfigFunc(func) {
  updateConfigFunc = func;
}

/**
 * Manages application status and provides clean exit functionality
 */
class StatusManager {
  constructor() {
    this.status = this.createInitialStatus();
    this.connections = new Map();
    this.shutdownHandlers = [];
    this.isShuttingDown = false;
    
    this.setupSignalHandlers();
  }

  createInitialStatus() {
    return {
      runTimestamp: new Date().toISOString(),
      deviceInfo: getDeviceInfo(),
      success: false,
      message: 'Initializing...',
      error: null,
      connections: {},
      metrics: {
        // TCP to Serial metrics
        bytesTransferredTcpToSerial: 0,
        bytesTransferredSerialToTcp: 0,
        // TCP to TCP metrics
        bytesTransferredTcpToSecondaryTcp: 0,
        bytesTransferredSecondaryTcpToTcp: 0,
        // General metrics
        totalConnections: 0,
        dataTransfers: 0,
        errors: 0
      },
      duration: 0
    };
  }

  /**
   * Update status with new values
   * @param {object} updates - Status updates
   */
  update(updates) {
    const previous = { ...this.status };
    this.status = { ...this.status, ...updates };
    
    logger.debug('Status updated', {
      changes: safeStringify(updates),
      previous: safeStringify(previous),
      current: safeStringify(this.status)
    });
  }

  /**
   * Update connection status
   * @param {string} connectionType - Type of connection (tcp, serial, secondary)
   * @param {object} connectionStatus - Connection details
   */
  updateConnection(connectionType, connectionStatus) {
    this.status.connections[connectionType] = {
      ...this.status.connections[connectionType],
      ...connectionStatus,
      lastUpdate: new Date().toISOString()
    };
    
    logger.debug(`${connectionType} connection status updated`, connectionStatus);
  }

  /**
   * Increment metrics
   * @param {string} metric - Metric name
   * @param {number} value - Value to add (default: 1)
   */
  incrementMetric(metric, value = 1) {
    if (this.status.metrics.hasOwnProperty(metric)) {
      this.status.metrics[metric] += value;
      logger.debug(`Metric updated: ${metric} = ${this.status.metrics[metric]}`);
    }
  }

  /**
   * Get current status
   * @returns {object} Current status
   */
  getStatus() {
    return {
      ...this.status,
      duration: Date.now() - new Date(this.status.runTimestamp).getTime()
    };
  }

  /**
   * Register a connection for cleanup during shutdown
   * @param {string} name - Connection name
   * @param {object} connection - Connection object with close method
   */
  registerConnection(name, connection) {
    this.connections.set(name, connection);
    logger.debug(`Connection registered: ${name}`);
  }

  /**
   * Unregister a connection
   * @param {string} name - Connection name
   */
  unregisterConnection(name) {
    this.connections.delete(name);
    logger.debug(`Connection unregistered: ${name}`);
  }

  /**
   * Register a shutdown handler
   * @param {Function} handler - Async function to call during shutdown
   */
  onShutdown(handler) {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Perform graceful shutdown
   * @param {boolean} success - Whether the operation was successful
   * @param {string} message - Final status message
   * @param {number} exitCode - Process exit code
   */
  async shutdown(success = false, message = '', exitCode = 0) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring duplicate request');
      return;
    }
    
    this.isShuttingDown = true;
    const startTime = Date.now();
    
    try {
      // Update final status
      this.update({
        success,
        message: message || (success ? 'Operation completed successfully' : 'Operation failed'),
        duration: Date.now() - new Date(this.status.runTimestamp).getTime()
      });

      const finalStatus = this.getStatus();
      
      if (success) {
        logger.info('Application shutting down successfully', finalStatus);
      } else {
        logger.error('Application shutting down with errors', finalStatus);
      }

      // Run custom shutdown handlers
      logger.debug(`Running ${this.shutdownHandlers.length} shutdown handlers`);
      for (const handler of this.shutdownHandlers) {
        try {
          await handler(finalStatus);
        } catch (error) {
          logger.error('Shutdown handler failed', { error: error.message });
        }
      }

      // Close all registered connections
      logger.debug(`Closing ${this.connections.size} registered connections`);
      for (const [name, connection] of this.connections) {
        try {
          if (connection && typeof connection.close === 'function') {
            await connection.close();
            logger.debug(`Connection closed: ${name}`);
          } else if (connection && typeof connection.destroy === 'function') {
            connection.destroy();
            logger.debug(`Connection destroyed: ${name}`);
          }
        } catch (error) {
          logger.warn(`Failed to close connection ${name}`, { error: error.message });
        }
      }

      const shutdownDuration = Date.now() - startTime;
      logger.info(`Graceful shutdown completed in ${shutdownDuration}ms`, { exitCode });
      
      // Post status to endpoint
      try {
        logger.info('Attempting to post status to endpoint...');
        await this.postStatusToEndpoint(finalStatus);
        logger.info('Status successfully posted to endpoint');
      } catch (error) {
        logger.error('Error posting status to endpoint', { error: error.message, stack: error.stack });
      }
      
      // Post logs to endpoint if collectLogs is enabled
      if (config && config.collectLogs === true) {
        try {
          logger.info('Posting logs to endpoint as specified in configuration');
          await loggerInstance.postLogs();
          
          // Update config to disable log collection after successful posting
          if (updateConfigFunc) {
            try {
              logger.info('Updating configuration to disable log collection for next run');
              await updateConfigFunc({ collectLogs: false });
              // Update local config reference
              config.collectLogs = false;
              // Disable log collection in logger
              loggerInstance.setCollectLogs(false);
            } catch (configError) {
              logger.error('Failed to update config to disable log collection', { error: configError.message });
            }
          }
        } catch (error) {
          logger.error('Error posting logs to endpoint', { error: error.message });
        }
      }
      
      // Give logger time to flush
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
    } finally {
      process.exit(exitCode);
    }
  }

  /**
   * Post status to the status endpoint
   * @param {Object} status - The current application status
   * @returns {Promise<void>}
   */
  async postStatusToEndpoint(status) {
    return new Promise((resolve, reject) => {
      try {
        // Add device ID to the status object
        const statusWithDeviceId = {
          ...status,
          deviceId: getDeviceId()
        };
        
        const data = JSON.stringify(statusWithDeviceId);
        
        const options = {
          hostname: 'status-2lbtz4kjxa-uc.a.run.app',
          port: 443,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          },
          timeout: 5000 // 5 second timeout
        };
        
        logger.info('Posting status to endpoint', { 
          endpoint: options.hostname,
          dataSize: data.length,
          deviceId: statusWithDeviceId.deviceId 
        });
        
        const req = https.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              logger.info(`Status posted to endpoint. Response status: ${res.statusCode}`);
              resolve();
            } else {
              logger.warn(`Status endpoint returned non-success code: ${res.statusCode}`, { response: responseData });
              resolve(); // Resolve anyway to continue shutdown process
            }
          });
        });
        
        req.on('error', (error) => {
          logger.error('Error posting status to endpoint', { error: error.message, stack: error.stack });
          resolve(); // Resolve anyway to continue shutdown process
        });
        
        req.on('timeout', () => {
          logger.error('Status endpoint request timed out');
          req.destroy();
          resolve(); // Resolve anyway to continue shutdown process
        });
        
        req.write(data);
        req.end();
      } catch (error) {
        logger.error('Unexpected error in postStatusToEndpoint', { error: error.message, stack: error.stack });
        resolve(); // Resolve anyway to continue shutdown process
      }
    });
  }
  
  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        logger.info(`Received ${signal} signal, initiating graceful shutdown`);
        try {
          await this.shutdown(false, `Terminated by ${signal} signal`, 0);
        } catch (error) {
          logger.error(`Error during ${signal} shutdown`, { error: error.message, stack: error.stack });
          process.exit(1);
        }
      });
    });

    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      try {
        await this.shutdown(false, `Terminated by uncaught exception: ${error.message}`, 1);
      } catch (shutdownError) {
        logger.error('Error during uncaughtException shutdown', { error: shutdownError.message });
        process.exit(1);
      }
    });

    process.on('unhandledRejection', async (reason, promise) => {
      logger.error('Unhandled promise rejection', { 
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: promise.toString()
      });
      await this.shutdown(false, `Unhandled rejection: ${reason}`, 1);
    });
  }
}

// Singleton instance
const statusManager = new StatusManager();

module.exports = {
  statusManager,
  getStatus: () => statusManager.getStatus(),
  updateStatus: (updates) => statusManager.update(updates),
  updateConnection: (type, status) => statusManager.updateConnection(type, status),
  incrementMetric: (metric, value) => statusManager.incrementMetric(metric, value),
  registerConnection: (name, connection) => statusManager.registerConnection(name, connection),
  shutdown: (success, message, exitCode) => statusManager.shutdown(success, message, exitCode),
  onShutdown: (handler) => statusManager.onShutdown(handler),
  setConfig,
  setUpdateConfigFunc
};