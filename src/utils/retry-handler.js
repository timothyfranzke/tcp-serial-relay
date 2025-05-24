// src/utils/retry-handler.js
const { logger } = require('./logger');

/**
 * Generic retry handler with exponential backoff
 */
class RetryHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.backoffFactor = options.backoffFactor || 2;
    this.jitter = options.jitter || false;
  }

  /**
   * Execute an async operation with retry logic
   * @param {Function} operation - Async function to execute
   * @param {string} operationName - Name for logging purposes
   * @param {object} context - Additional context for logging
   * @returns {Promise} - Result of the operation
   */
  async execute(operation, operationName = 'operation', context = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Attempting ${operationName}`, { 
          attempt, 
          maxRetries: this.maxRetries,
          ...context 
        });
        
        const result = await operation(attempt);
        
        if (attempt > 1) {
          logger.info(`${operationName} succeeded after ${attempt} attempts`, context);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        logger.warn(`${operationName} failed`, {
          attempt,
          maxRetries: this.maxRetries,
          error: error.message,
          willRetry: attempt < this.maxRetries,
          ...context
        });
        
        if (attempt === this.maxRetries) {
          break;
        }
        
        const delay = this.calculateDelay(attempt);
        logger.debug(`Retrying ${operationName} in ${delay}ms`);
        await this.sleep(delay);
      }
    }
    
    const finalError = new Error(
      `${operationName} failed after ${this.maxRetries} attempts: ${lastError.message}`
    );
    finalError.originalError = lastError;
    finalError.attempts = this.maxRetries;
    
    logger.error(`${operationName} permanently failed`, {
      attempts: this.maxRetries,
      finalError: lastError.message,
      ...context
    });
    
    throw finalError;
  }

  /**
   * Calculate delay for next retry with exponential backoff
   * @param {number} attempt - Current attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    let delay = this.baseDelay * Math.pow(this.backoffFactor, attempt - 1);
    delay = Math.min(delay, this.maxDelay);
    
    if (this.jitter) {
      // Add random jitter ±25%
      const jitterRange = delay * 0.25;
      delay += (Math.random() - 0.5) * 2 * jitterRange;
    }
    
    return Math.round(delay);
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a retry handler with common connection settings
 * @param {object} options - Override options
 * @returns {RetryHandler} Configured retry handler
 */
function createConnectionRetryHandler(options = {}) {
  return new RetryHandler({
    maxRetries: 3,
    baseDelay: 2000,
    maxDelay: 15000,
    backoffFactor: 2,
    jitter: true,
    ...options
  });
}

/**
 * Create a retry handler for quick operations
 * @param {object} options - Override options
 * @returns {RetryHandler} Configured retry handler
 */
function createQuickRetryHandler(options = {}) {
  return new RetryHandler({
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 2000,
    backoffFactor: 1.5,
    jitter: false,
    ...options
  });
}

module.exports = {
  RetryHandler,
  createConnectionRetryHandler,
  createQuickRetryHandler
};