// src/config/index.js
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { getDeviceId } = require('../utils/device-info');
const defaultConfig = require('./default-config');

class ConfigManager {
  constructor() {
    this.configPath = path.join(process.cwd(), 'config', 'relay-config.json');
    this.config = null;
  }

  async load() {
    if (this.config) {
      return this.config;
    }

    const deviceId = getDeviceId();
    logger.info(`Loading configuration for device: ${deviceId}`);

    try {
      this.ensureConfigDirectory();
      this.config = await this.loadFromFile();
      this.applyEnvironmentOverrides();
      this.validateConfig();
      
      logger.info('Configuration loaded successfully', {
        source: fs.existsSync(this.configPath) ? 'file' : 'defaults',
        config: this.getSafeConfigForLogging()
      });

      return this.config;
    } catch (error) {
      logger.error('Failed to load configuration', { error: error.message });
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  ensureConfigDirectory() {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      logger.debug(`Created config directory: ${configDir}`);
    }
  }

  async loadFromFile() {
    let config = { ...defaultConfig };

    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(fileContent);
        config = { ...defaultConfig, ...loadedConfig };
        logger.debug('Configuration loaded from existing file');
      } catch (error) {
        logger.warn('Error reading config file, using defaults', { 
          error: error.message,
          configPath: this.configPath 
        });
      }
    } else {
      // Create default config file
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
      logger.info('Created default configuration file', { configPath: this.configPath });
    }

    return config;
  }

  applyEnvironmentOverrides() {
    // Override with environment variables
    if (process.env.TCP_IP) {
      this.config.tcpIp = process.env.TCP_IP;
      logger.debug('TCP IP overridden from environment');
    }

    if (process.env.TCP_PORT) {
      this.config.tcpPort = parseInt(process.env.TCP_PORT, 10);
      logger.debug('TCP port overridden from environment');
    }

    if (process.env.SERIAL_PATH) {
      this.config.serialPath = process.env.SERIAL_PATH;
      logger.debug('Serial path overridden from environment');
    }

    if (process.env.SERIAL_BAUD) {
      this.config.serialBaud = parseInt(process.env.SERIAL_BAUD, 10);
      logger.debug('Serial baud rate overridden from environment');
    }

    // Mock environment override
    if (process.env.MOCK_ENV === 'true') {
      this.config.serialPath = '/dev/ttyMOCK0';
      logger.info('Serial path overridden for mock environment');
    }
  }

  validateConfig() {
    const errors = [];

    // Validate TCP configuration
    if (!this.config.tcpIp || typeof this.config.tcpIp !== 'string') {
      errors.push('Invalid TCP IP address');
    }

    if (!this.config.tcpPort || !Number.isInteger(this.config.tcpPort) || 
        this.config.tcpPort < 1 || this.config.tcpPort > 65535) {
      errors.push('Invalid TCP port (must be 1-65535)');
    }

    // Validate Serial configuration
    if (!this.config.serialPath || typeof this.config.serialPath !== 'string') {
      errors.push('Invalid serial path');
    }

    if (!this.config.serialBaud || !Number.isInteger(this.config.serialBaud) || 
        this.config.serialBaud < 1) {
      errors.push('Invalid serial baud rate');
    }

    const validParities = ['none', 'even', 'odd', 'mark', 'space'];
    if (!validParities.includes(this.config.serialParity)) {
      errors.push(`Invalid serial parity (must be one of: ${validParities.join(', ')})`);
    }

    if (![5, 6, 7, 8].includes(this.config.serialDataBits)) {
      errors.push('Invalid serial data bits (must be 5, 6, 7, or 8)');
    }

    if (![1, 1.5, 2].includes(this.config.serialStopBits)) {
      errors.push('Invalid serial stop bits (must be 1, 1.5, or 2)');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
  }

  getSafeConfigForLogging() {
    // Return config without sensitive data for logging
    return {
      tcpIp: this.config.tcpIp,
      tcpPort: this.config.tcpPort,
      serialPath: this.config.serialPath,
      serialBaud: this.config.serialBaud,
      serialParity: this.config.serialParity,
      serialDataBits: this.config.serialDataBits,
      serialStopBits: this.config.serialStopBits
    };
  }

  // Allow updating config at runtime
  async update(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.validateConfig();
    
    // Save to file
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    logger.info('Configuration updated and saved', { 
      updates: Object.keys(newConfig),
      config: this.getSafeConfigForLogging()
    });
  }

  get() {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return { ...this.config };
  }
}

// Singleton instance
const configManager = new ConfigManager();

module.exports = {
  configManager,
  loadConfig: () => configManager.load(),
  getConfig: () => configManager.get(),
  updateConfig: (newConfig) => configManager.update(newConfig)
};