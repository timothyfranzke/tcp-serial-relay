// src/utils/status-manager.js
const { logger, safeStringify, loggerInstance } = require("./logger");
const { getDeviceInfo, getDeviceId } = require("./device-info");
const https = require("https");
let config = null;
let updateConfigFunc = null;

// Function to set the config reference
function setConfig(configObj) {
  config = configObj;

  // Enable log collection if specified in config
  if (config && config.collectLogs === true) {
    loggerInstance.setCollectLogs(true);
    logger.info("Log collection enabled from configuration");
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
      message: "Initializing...",
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
        errors: 0,
      },
      duration: 0,
    };
  }

  /**
   * Update status with new values
   * @param {object} updates - Status updates
   */
  update(updates) {
    const previous = { ...this.status };
    this.status = { ...this.status, ...updates };

    logger.debug("Status updated", {
      changes: safeStringify(updates),
      previous: safeStringify(previous),
      current: safeStringify(this.status),
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
      lastUpdate: new Date().toISOString(),
    };

    logger.debug(
      `${connectionType} connection status updated`,
      connectionStatus
    );
  }

  /**
   * Increment metrics
   * @param {string} metric - Metric name
   * @param {number} value - Value to add (default: 1)
   */
  incrementMetric(metric, value = 1) {
    if (this.status.metrics.hasOwnProperty(metric)) {
      this.status.metrics[metric] += value;
      logger.debug(
        `Metric updated: ${metric} = ${this.status.metrics[metric]}`
      );
    }
  }

  /**
   * Get current status
   * @returns {object} Current status
   */
  getStatus() {
    return {
      ...this.status,
      duration: Date.now() - new Date(this.status.runTimestamp).getTime(),
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
   * Enhanced graceful shutdown with comprehensive error handling
   */
  async shutdown(success = false, message = "", exitCode = 0) {
    if (this.isShuttingDown) {
      logger.warn("Shutdown already in progress, ignoring duplicate request");
      return;
    }

    this.isShuttingDown = true;
    const startTime = Date.now();
    let statusPosted = false;
    let logsPosted = false;

    try {
      // Update final status
      this.update({
        success,
        message:
          message ||
          (success ? "Operation completed successfully" : "Operation failed"),
        duration: Date.now() - new Date(this.status.runTimestamp).getTime(),
      });

      const finalStatus = this.getStatus();

      if (success) {
        logger.info("Application shutting down successfully", finalStatus);
      } else {
        logger.error("Application shutting down with errors", finalStatus);
      }

      // Run custom shutdown handlers with individual error handling
      logger.debug(`Running ${this.shutdownHandlers.length} shutdown handlers`);
      for (let i = 0; i < this.shutdownHandlers.length; i++) {
        try {
          await Promise.race([
            this.shutdownHandlers[i](finalStatus),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Shutdown handler timeout")),
                5000
              )
            ),
          ]);
          logger.debug(`Shutdown handler ${i + 1} completed successfully`);
        } catch (error) {
          logger.error(`Shutdown handler ${i + 1} failed`, {
            error: error.message,
          });
          // Continue with other handlers
        }
      }

      // Close all registered connections with individual error handling
      logger.debug(`Closing ${this.connections.size} registered connections`);
      for (const [name, connection] of this.connections) {
        try {
          await Promise.race([
            this.closeConnection(name, connection),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Connection close timeout")),
                3000
              )
            ),
          ]);
          logger.debug(`Connection closed: ${name}`);
        } catch (error) {
          logger.warn(`Failed to close connection ${name}`, {
            error: error.message,
          });
          // Continue with other connections
        }
      }

      const shutdownDuration = Date.now() - startTime;
      logger.info(`Connection cleanup completed in ${shutdownDuration}ms`);

      // Post status to endpoint with retries
      try {
        logger.info("Attempting to post status to endpoint...");
        statusPosted = await this.postStatusWithRetry(finalStatus, 3);
        if (statusPosted) {
          logger.info("Status successfully posted to endpoint");
        } else {
          logger.warn("Failed to post status after all retries");
        }
      } catch (error) {
        logger.error("Error posting status to endpoint", {
          error: error.message,
          stack: error.stack,
        });
      }

      // Post logs to endpoint if collectLogs is enabled
      if (config && config.collectLogs === true) {
        try {
          logger.info("Posting logs to endpoint as specified in configuration");
          logsPosted = await this.postLogsWithRetry(3);

          if (logsPosted && updateConfigFunc) {
            try {
              logger.info(
                "Updating configuration to disable log collection for next run"
              );
              await updateConfigFunc({ collectLogs: false });
              config.collectLogs = false;
              loggerInstance.setCollectLogs(false);
            } catch (configError) {
              logger.error(
                "Failed to update config to disable log collection",
                {
                  error: configError.message,
                }
              );
            }
          }
        } catch (error) {
          logger.error("Error posting logs to endpoint", {
            error: error.message,
          });
        }
      }

      // Final status update
      const totalShutdownDuration = Date.now() - startTime;
      logger.info(`Graceful shutdown completed in ${totalShutdownDuration}ms`, {
        exitCode,
        statusPosted,
        logsPosted: config?.collectLogs ? logsPosted : "not_required",
      });

      // Give logger time to flush with timeout
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, 200)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Logger flush timeout")), 1000)
        ),
      ]).catch(() => {
        // Timeout is acceptable here
      });
    } catch (error) {
      logger.error("Error during shutdown process", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      // Ensure we always exit
      logger.info(`Process exiting with code ${exitCode}`);
      process.exit(exitCode);
    }
  }

  /**
   * Helper method to close individual connections
   */
  async closeConnection(name, connection) {
    if (connection && typeof connection.close === "function") {
      await connection.close();
    } else if (connection && typeof connection.destroy === "function") {
      connection.destroy();
    } else if (connection && typeof connection.end === "function") {
      connection.end();
    } else {
      logger.debug(`Connection ${name} has no standard close method`);
    }
  }

  /**
 * Post status with retry logic
 */
async postStatusWithRetry(status, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.postStatusToEndpoint(status);
      return true;
    } catch (error) {
      logger.warn(`Status post attempt ${attempt} failed`, { 
        error: error.message,
        attempt,
        maxRetries
      });
      
      if (attempt === maxRetries) {
        return false;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

/**
 * Post logs with retry logic
 */
async postLogsWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await loggerInstance.postLogs();
      return result;
    } catch (error) {
      logger.warn(`Logs post attempt ${attempt} failed`, { 
        error: error.message,
        attempt,
        maxRetries
      });
      
      if (attempt === maxRetries) {
        return false;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

/**
 * Enhanced status posting with timeout and better error handling
 */
async postStatusToEndpoint(status) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 10000; // 10 second timeout
    let requestCompleted = false;
    
    try {
      const statusWithDeviceId = {
        ...status,
        deviceId: getDeviceId(),
        timestamp: new Date().toISOString()
      };
      
      const data = JSON.stringify(statusWithDeviceId);
      
      const options = {
        hostname: 'status-2lbtz4kjxa-uc.a.run.app',
        port: 443,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          'User-Agent': 'tcp-serial-relay/1.0'
        }
      };
      
      logger.debug('Posting status to endpoint', { 
        endpoint: options.hostname,
        dataSize: data.length,
        deviceId: statusWithDeviceId.deviceId 
      });
      
      const req = https.request(options, (res) => {
        if (requestCompleted) return;
        
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          if (requestCompleted) return;
          requestCompleted = true;
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.debug(`Status posted successfully. Status: ${res.statusCode}`);
            resolve();
          } else {
            const error = new Error(`Status endpoint returned ${res.statusCode}: ${responseData.substring(0, 200)}`);
            logger.warn('Status endpoint returned non-success code', { 
              statusCode: res.statusCode, 
              response: responseData.substring(0, 200) 
            });
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        if (requestCompleted) return;
        requestCompleted = true;
        
        logger.error('Status post request error', { error: error.message });
        reject(error);
      });
      
      // Enhanced timeout handling
      const timeout = setTimeout(() => {
        if (requestCompleted) return;
        requestCompleted = true;
        
        logger.error(`Status post request timed out after ${timeoutMs}ms`);
        req.destroy();
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      req.on('response', () => {
        clearTimeout(timeout);
      });
      
      req.write(data);
      req.end();
      
    } catch (error) {
      if (requestCompleted) return;
      requestCompleted = true;
      
      logger.error('Unexpected error in postStatusToEndpoint', { 
        error: error.message, 
        stack: error.stack 
      });
      reject(error);
    }
  });
}

  setupSignalHandlers() {
    const signals = ["SIGINT", "SIGTERM"];

    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.info(`Received ${signal} signal, initiating graceful shutdown`);
        try {
          await this.shutdown(false, `Terminated by ${signal} signal`, 0);
        } catch (error) {
          logger.error(`Error during ${signal} shutdown`, {
            error: error.message,
            stack: error.stack,
          });
          process.exit(1);
        }
      });
    });

    process.on("uncaughtException", async (error) => {
      logger.error("Uncaught exception", {
        error: error.message,
        stack: error.stack,
      });
      try {
        await this.shutdown(
          false,
          `Terminated by uncaught exception: ${error.message}`,
          1
        );
      } catch (shutdownError) {
        logger.error("Error during uncaughtException shutdown", {
          error: shutdownError.message,
        });
        process.exit(1);
      }
    });

    process.on("unhandledRejection", async (reason, promise) => {
      logger.error("Unhandled promise rejection", {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: promise.toString(),
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
  updateConnection: (type, status) =>
    statusManager.updateConnection(type, status),
  incrementMetric: (metric, value) =>
    statusManager.incrementMetric(metric, value),
  registerConnection: (name, connection) =>
    statusManager.registerConnection(name, connection),
  shutdown: (success, message, exitCode) =>
    statusManager.shutdown(success, message, exitCode),
  onShutdown: (handler) => statusManager.onShutdown(handler),
  setConfig,
  setUpdateConfigFunc,
};
