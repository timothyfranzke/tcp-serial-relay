// src/utils/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const https = require('https');
require('winston-daily-rotate-file');
const { getDeviceId } = require('./device-info');

class Logger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.setupLogDirectory();
    this.createLoggers();
    this.collectLogs = false;
    this.logBuffer = [];
    this.maxBufferSize = 1000; // Limit buffer size to prevent memory issues
  }

  setupLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  createLoggers() {
    // Create a custom format that also captures logs for the buffer if collectLogs is enabled
    const captureFormat = winston.format((info) => {
      if (this.collectLogs) {
        // Store log entry in buffer for later posting
        if (this.logBuffer.length < this.maxBufferSize) {
          this.logBuffer.push({
            timestamp: info.timestamp || new Date().toISOString(),
            level: (info.level || 'info').toString().toLowerCase(),
            message: info.message || '',
            additionalData: { ...info, timestamp: undefined, level: undefined, message: undefined }
          });
        }
      }
      return info;
    });

    // Main application logger
    this.appLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true }),
        captureFormat(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          // Ensure level is a string and handle potential undefined/null values
          const levelStr = (level || 'info').toString().toUpperCase();
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          
          if (stack) {
            return `${timestamp} [${levelStr}]: ${message}\n${stack}${metaStr}`;
          }
          return `${timestamp} [${levelStr}]: ${message}${metaStr}`;
        })
      ),
      transports: this.createTransports(),
      exceptionHandlers: this.createExceptionHandlers(),
      rejectionHandlers: this.createRejectionHandlers()
    });

    // Data transfer logger for high-frequency logs
    this.dataLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
      ),
      transports: [
        new winston.transports.DailyRotateFile({
          filename: path.join(this.logDir, 'data-transfer-%DATE%.log'),
          datePattern: 'YYYY-MM-DD-HH',
          zippedArchive: true,
          maxSize: '50m',
          maxFiles: '7d'
        })
      ]
    });

    this.appLogger.info('Logger initialized', {
      logDir: this.logDir,
      logLevel: this.appLogger.level,
      nodeEnv: process.env.NODE_ENV || 'development'
    });
  }

  createTransports() {
    const transports = [];

    // Console transport
    if (process.env.NODE_ENV !== 'production') {
      transports.push(
        new winston.transports.Console({
          level: 'info',
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) => {
              const levelStr = (level || 'info').toString();
              return `${timestamp} ${levelStr}: ${message}`;
            })
          )
        })
      );
    }

    // File transports
    transports.push(
      // Main log file
      new winston.transports.DailyRotateFile({
        filename: path.join(this.logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        level: 'info'
      }),

      // Error-only log file
      new winston.transports.DailyRotateFile({
        filename: path.join(this.logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '30d',
        level: 'info'
      })
    );

    return transports;
  }

  createExceptionHandlers() {
    return [
      new winston.transports.DailyRotateFile({
        filename: path.join(this.logDir, 'exceptions-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '30d'
      })
    ];
  }

  createRejectionHandlers() {
    return [
      new winston.transports.DailyRotateFile({
        filename: path.join(this.logDir, 'rejections-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '30d'
      })
    ];
  }

  // Public methods to get loggers
  getAppLogger() {
    return this.appLogger;
  }

  getDataLogger() {
    return this.dataLogger;
  }

  // Utility method for safe object stringification
  safeStringify(obj, maxDepth = 3) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, val) => {
      if (val != null && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }, 2);
  }

  /**
   * Enable log collection
   * @param {boolean} collect - Whether to collect logs
   */
  setCollectLogs(collect) {
    this.collectLogs = collect;
    this.appLogger.info(`Log collection ${collect ? 'enabled' : 'disabled'}`);
    if (!collect) {
      // Clear buffer if collection is disabled
      this.clearLogBuffer();
    }
  }

  /**
   * Clear the log buffer
   */
  clearLogBuffer() {
    const count = this.logBuffer.length;
    this.logBuffer = [];
    this.appLogger.debug(`Cleared log buffer (${count} entries)`);
  }

  /**
   * Get the current log buffer
   * @returns {Array} Array of log entries
   */
  getLogBuffer() {
    return [...this.logBuffer];
  }

  /**
   * Post logs to the specified endpoint
   * @returns {Promise<boolean>} Success status
   */
  async postLogs() {
    if (!this.collectLogs || this.logBuffer.length === 0) {
      this.appLogger.info('No logs to post to endpoint');
      return false;
    }

    const deviceId = getDeviceId();
    
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        deviceId,
        logs: this.logBuffer
      });
      
      const options = {
        hostname: 'logs-2lbtz4kjxa-uc.a.run.app',
        path: '/',
        port: 443,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };
      
      this.appLogger.info('Posting logs to endpoint', { 
        endpoint: 'https://logs-2lbtz4kjxa-uc.a.run.app',
        deviceId,
        logCount: this.logBuffer.length
      });
      
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            this.appLogger.info('Logs successfully posted to endpoint', { 
              statusCode: res.statusCode,
              response: responseData.substring(0, 100) // Log only first 100 chars
            });
            this.clearLogBuffer();
            resolve(true);
          } else {
            this.appLogger.warn('Failed to post logs to endpoint', { 
              statusCode: res.statusCode,
              response: responseData.substring(0, 100)
            });
            resolve(false);
          }
        });
      });
      
      req.on('error', (error) => {
        this.appLogger.error('Error posting logs to endpoint', { error: error.message });
        resolve(false);
      });
      
      req.setTimeout(10000, () => {
        this.appLogger.warn('Log posting request timed out');
        req.abort();
        resolve(false);
      });
      
      req.write(postData);
      req.end();
    });
  }

  // Graceful shutdown
  async close() {
    return new Promise((resolve) => {
      this.appLogger.on('finish', resolve);
      this.appLogger.end();
    });
  }
}

// Singleton instance
const loggerInstance = new Logger();

module.exports = {
  logger: loggerInstance.getAppLogger(),
  dataLogger: loggerInstance.getDataLogger(),
  loggerInstance,
  safeStringify: loggerInstance.safeStringify.bind(loggerInstance)
};