// src/utils/logger.js

// Simple console logger for PM2 compatibility
class Logger {
  constructor() {
    // PM2 will handle log rotation and file management
  }

  // Create simple console loggers
  getAppLogger() {
    return {
      info: (message, meta) => {
        const metaStr = meta ? ` ${this.safeStringify(meta)}` : '';
        console.log(`[INFO]: ${message}${metaStr}`);
      },
      error: (message, meta) => {
        const metaStr = meta ? ` ${this.safeStringify(meta)}` : '';
        console.error(`[ERROR]: ${message}${metaStr}`);
      },
      warn: (message, meta) => {
        const metaStr = meta ? ` ${this.safeStringify(meta)}` : '';
        console.warn(`[WARN]: ${message}${metaStr}`);
      },
      debug: (message, meta) => {
        if (process.env.LOG_LEVEL === 'debug') {
          const metaStr = meta ? ` ${this.safeStringify(meta)}` : '';
          console.debug(`[DEBUG]: ${message}${metaStr}`);
        }
      }
    };
  }

  getDataLogger() {
    return {
      info: (message, meta) => {
        const metaStr = meta ? ` ${this.safeStringify(meta)}` : '';
        console.log(`[DATA]: ${message}${metaStr}`);
      },
      silly: (message, meta) => {
        if (process.env.LOG_LEVEL === 'debug') {
          const metaStr = meta ? ` ${this.safeStringify(meta)}` : '';
          console.log(`[DATA-SILLY]: ${message}${metaStr}`);
        }
      }
    };
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

  // No-op methods for backward compatibility
  setCollectLogs(collect) {
    // Not needed for PM2
  }

  clearLogBuffer() {
    // Not needed for PM2
  }

  getLogBuffer() {
    return [];
  }

  async postLogs() {
    return false;
  }

  async close() {
    // Not needed for console logging
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