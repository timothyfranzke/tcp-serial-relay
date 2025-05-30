// src/config/index.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const { logger } = require('../utils/logger');
const { getDeviceId } = require('../utils/device-info');
const defaultConfig = require('./default-config');

/**
 * Get the configuration file path with proper precedence
 */
function getConfigPath() {
  // 1. Environment variable override (highest priority)
  if (process.env.CONFIG_PATH) {
    return process.env.CONFIG_PATH;
  }

  // 2. System-wide config (for production deployments)
  const systemConfigPath = '/etc/tcp-serial-relay/relay-config.json';
  if (fs.existsSync(systemConfigPath)) {
    return systemConfigPath;
  }

  // 3. Local config directory (for development/local use)
  const localConfigPath = path.join(process.cwd(), 'config', 'relay-config.json');
  
  // 4. Fallback to home directory config
  const homeConfigPath = path.join(require('os').homedir(), '.tcp-serial-relay', 'relay-config.json');

  // Prefer local config if it exists, otherwise use home directory
  if (fs.existsSync(localConfigPath)) {
    return localConfigPath;
  }

  return homeConfigPath;
}

class ConfigManager {
  constructor() {
    this.configPath = getConfigPath();
    this.config = null;
  }

  /**
   * Fetch configuration from remote endpoint
   * @param {string} deviceId - Device ID to fetch configuration for
   * @returns {Promise<object|null>} - Configuration object or null if not found
   */
  async fetchRemoteConfig(deviceId) {
    return new Promise((resolve) => {
      const url = `https://config-2lbtz4kjxa-uc.a.run.app?docId=${deviceId}`;
      logger.info(`Attempting to fetch remote configuration from: ${url}`);
      
      const req = https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const remoteConfig = JSON.parse(data);
              logger.info('Remote configuration fetched successfully');
              resolve(remoteConfig);
            } catch (error) {
              logger.warn('Failed to parse remote configuration', { error: error.message });
              resolve(null);
            }
          } else {
            logger.warn(`Failed to fetch remote configuration, status: ${res.statusCode}`);
            resolve(null);
          }
        });
      });
      
      req.on('error', (error) => {
        logger.warn('Error fetching remote configuration', { error: error.message });
        resolve(null);
      });
      
      req.setTimeout(5000, () => {
        logger.warn('Remote configuration request timed out');
        req.abort();
        resolve(null);
      });
    });
  }
  
  /**
   * Post local configuration to remote endpoint
   * @param {object} config - Configuration object to post
   * @param {string} deviceId - Device ID to associate with the configuration
   * @returns {Promise<boolean>} - Success status
   */
  async postConfigToRemote(config, deviceId) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        ...config,
        docId: deviceId
      });
      
      const options = {
        hostname: 'config-2lbtz4kjxa-uc.a.run.app',
        port: 443,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };
      
      logger.info('Posting configuration to remote endpoint');
      
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            logger.info('Configuration posted successfully to remote endpoint');
            resolve(true);
          } else {
            logger.warn(`Failed to post configuration to remote endpoint, status: ${res.statusCode}`);
            resolve(false);
          }
        });
      });
      
      req.on('error', (error) => {
        logger.warn('Error posting configuration to remote endpoint', { error: error.message });
        resolve(false);
      });
      
      req.setTimeout(5000, () => {
        logger.warn('Remote configuration post request timed out');
        req.abort();
        resolve(false);
      });
      
      req.write(postData);
      req.end();
    });
  }

  async load() {
    if (this.config) {
      return this.config;
    }

    const deviceId = getDeviceId();
    logger.info(`Loading configuration for device: ${deviceId}`);
    logger.info(`Configuration path: ${this.configPath}`);

    try {
      // First try to fetch remote configuration
      const remoteConfig = await this.fetchRemoteConfig(deviceId);
      
      if (remoteConfig) {
        logger.info('Using remote configuration');
        this.config = { ...defaultConfig, ...remoteConfig };
        this.applyEnvironmentOverrides();
        this.validateConfig();
        
        // Save the remote config to local file
        try {
          this.ensureConfigDirectory();
          fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
          logger.info(`Remote configuration saved to local file: ${this.configPath}`);
        } catch (error) {
          logger.warn(`Could not save remote configuration to local file: ${error.message}`);
        }
      } else {
        // Fall back to local configuration
        logger.info('Remote configuration not available, using local configuration');
        this.ensureConfigDirectory();
        this.config = await this.loadFromFile();
        this.applyEnvironmentOverrides();
        this.validateConfig();
        
        // Post local configuration to remote endpoint
        await this.postConfigToRemote(this.config, deviceId);
      }
      
      logger.info('Configuration loaded successfully', {
        source: remoteConfig ? 'remote' : (fs.existsSync(this.configPath) ? 'local file' : 'defaults'),
        configPath: this.configPath,
        config: this.getSafeConfigForLogging()
      });

      return this.config;
    } catch (error) {
      logger.error('Failed to load configuration', { 
        error: error.message,
        configPath: this.configPath
      });
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  ensureConfigDirectory() {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      try {
        fs.mkdirSync(configDir, { recursive: true });
        logger.info(`Created config directory: ${configDir}`);
      } catch (error) {
        logger.warn(`Could not create config directory: ${error.message}`);
        // Try to use a fallback location
        this.configPath = path.join(require('os').tmpdir(), 'tcp-serial-relay-config.json');
        logger.info(`Using fallback config path: ${this.configPath}`);
      }
    }
  }

  async loadFromFile() {
    let config = { ...defaultConfig };

    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(fileContent);
        config = { ...defaultConfig, ...loadedConfig };
        logger.info(`Configuration loaded from existing file: ${this.configPath}`);
      } catch (error) {
        logger.warn('Error reading config file, using defaults', { 
          error: error.message,
          configPath: this.configPath 
        });
      }
    } else {
      // Create default config file
      try {
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
        logger.info(`Created default configuration file: ${this.configPath}`);
      } catch (error) {
        logger.warn(`Could not create config file: ${error.message}`);
      }
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

    if (process.env.CONNECTION_TYPE) {
      this.config.connectionType = process.env.CONNECTION_TYPE;
      logger.debug('Connection type overridden from environment');
    }

    if (process.env.SERIAL_PATH) {
      this.config.serialPath = process.env.SERIAL_PATH;
      logger.debug('Serial path overridden from environment');
    }

    if (process.env.SERIAL_BAUD) {
      this.config.serialBaud = parseInt(process.env.SERIAL_BAUD, 10);
      logger.debug('Serial baud rate overridden from environment');
    }

    if (process.env.SECONDARY_TCP_IP) {
      this.config.secondaryTcpIp = process.env.SECONDARY_TCP_IP;
      logger.debug('Secondary TCP IP overridden from environment');
    }

    if (process.env.SECONDARY_TCP_PORT) {
      this.config.secondaryTcpPort = parseInt(process.env.SECONDARY_TCP_PORT, 10);
      logger.debug('Secondary TCP port overridden from environment');
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

    // Validate connection type
    if (!['serial', 'tcp'].includes(this.config.connectionType)) {
      errors.push('Invalid connection type (must be "serial" or "tcp")');
    }

    // Validate Serial configuration if connectionType is 'serial'
    if (this.config.connectionType === 'serial') {
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
    }

    // Validate secondary TCP configuration if connectionType is 'tcp'
    if (this.config.connectionType === 'tcp') {
      if (!this.config.secondaryTcpIp || typeof this.config.secondaryTcpIp !== 'string') {
        errors.push('Invalid secondary TCP IP address');
      }

      if (!this.config.secondaryTcpPort || !Number.isInteger(this.config.secondaryTcpPort) || 
          this.config.secondaryTcpPort < 1 || this.config.secondaryTcpPort > 65535) {
        errors.push('Invalid secondary TCP port (must be 1-65535)');
      }

      // Check for port conflicts
      if (this.config.tcpIp === this.config.secondaryTcpIp && 
          this.config.tcpPort === this.config.secondaryTcpPort) {
        errors.push('Primary and secondary TCP endpoints cannot be the same');
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
  }

  getSafeConfigForLogging() {
    // Return config without sensitive data for logging
    const safeConfig = {
      tcpIp: this.config.tcpIp,
      tcpPort: this.config.tcpPort,
      connectionType: this.config.connectionType
    };

    if (this.config.connectionType === 'serial') {
      safeConfig.serialPath = this.config.serialPath;
      safeConfig.serialBaud = this.config.serialBaud;
      safeConfig.serialParity = this.config.serialParity;
      safeConfig.serialDataBits = this.config.serialDataBits;
      safeConfig.serialStopBits = this.config.serialStopBits;
    } else if (this.config.connectionType === 'tcp') {
      safeConfig.secondaryTcpIp = this.config.secondaryTcpIp;
      safeConfig.secondaryTcpPort = this.config.secondaryTcpPort;
    }

    return safeConfig;
  }

  // Allow updating config at runtime
  async update(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.validateConfig();
    
    // Save to file
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      logger.info('Configuration updated and saved', { 
        updates: Object.keys(newConfig),
        configPath: this.configPath,
        config: this.getSafeConfigForLogging()
      });
    } catch (error) {
      logger.error('Failed to save configuration', { 
        error: error.message,
        configPath: this.configPath
      });
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  get() {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return { ...this.config };
  }

  getConfigPath() {
    return this.configPath;
  }
}

// Singleton instance
const configManager = new ConfigManager();

module.exports = {
  configManager,
  getConfigPath,
  loadConfig: () => configManager.load(),
  getConfig: () => configManager.get(),
  updateConfig: (newConfig) => configManager.update(newConfig)
};