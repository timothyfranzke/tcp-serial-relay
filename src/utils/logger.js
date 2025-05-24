// src/utils/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');
require('winston-daily-rotate-file');

class Logger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.setupLogDirectory();
    this.createLoggers();
  }

  setupLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  createLoggers() {
    // Main application logger
    this.appLogger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          if (stack) {
            return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}${metaStr}`;
          }
          return `${timestamp} [${level.toUpperCase()}]: ${message}${metaStr}`;
        })
      ),
      transports: this.createTransports(),
      exceptionHandlers: this.createExceptionHandlers(),
      rejectionHandlers: this.createRejectionHandlers()
    });

    // Data transfer logger for high-frequency logs
    this.dataLogger = winston.createLogger({
      level: 'silly',
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
          level: 'debug',
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) => 
              `${timestamp} ${level}: ${message}`
            )
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
        level: 'debug'
      }),

      // Error-only log file
      new winston.transports.DailyRotateFile({
        filename: path.join(this.logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '30d',
        level: 'error'
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