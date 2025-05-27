// src/dashboard/routes/config.js
const fs = require('fs');
const path = require('path');

class ConfigRoutes {
  constructor() {
    this.configPath = process.env.CONFIG_PATH || '/etc/tcp-serial-relay/relay-config.json';
    this.backupDir = path.join(path.dirname(this.configPath), 'backups');
  }

  // GET /api/config
  async getConfig(req, res) {
    try {
      const config = this.loadConfig();
      const metadata = this.getConfigMetadata();
      
      res.json({
        config,
        metadata,
        path: this.configPath
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to load configuration',
        message: error.message 
      });
    }
  }

  // PUT /api/config
  async updateConfig(req, res) {
    try {
      const newConfig = req.body;
      
      // Validate configuration
      const validation = this.validateConfig(newConfig);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Configuration validation failed',
          errors: validation.errors
        });
      }

      // Backup current config
      await this.backupConfig();

      // Save new config
      this.saveConfig(newConfig);

      res.json({
        success: true,
        message: 'Configuration updated successfully'
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to update configuration',
        message: error.message 
      });
    }
  }

  // GET /api/config/validate
  async validateConfigEndpoint(req, res) {
    try {
      const config = req.body || this.loadConfig();
      const validation = this.validateConfig(config);
      res.json(validation);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to validate configuration',
        message: error.message 
      });
    }
  }

  // GET /api/config/backups
  async getBackups(req, res) {
    try {
      const backups = this.listBackups();
      res.json(backups);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to list backups',
        message: error.message 
      });
    }
  }

  // POST /api/config/restore/:backupId
  async restoreBackup(req, res) {
    try {
      const { backupId } = req.params;
      const backupFile = path.join(this.backupDir, backupId);
      
      if (!fs.existsSync(backupFile)) {
        return res.status(404).json({
          error: 'Backup file not found'
        });
      }

      // Validate backup before restoring
      const backupConfig = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      const validation = this.validateConfig(backupConfig);
      
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Backup file contains invalid configuration',
          errors: validation.errors
        });
      }

      // Create backup of current config before restoring
      await this.backupConfig();

      // Restore from backup
      fs.copyFileSync(backupFile, this.configPath);

      res.json({
        success: true,
        message: 'Configuration restored from backup'
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to restore backup',
        message: error.message 
      });
    }
  }

  // GET /api/config/defaults
  async getDefaults(req, res) {
    try {
      const defaultConfig = require('../../config/default-config');
      res.json(defaultConfig);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to load default configuration',
        message: error.message 
      });
    }
  }

  loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        // Return default config if file doesn't exist
        return require('../../config/default-config');
      }

      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error.message}`);
    }
  }

  saveConfig(config) {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Write config file
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  getConfigMetadata() {
    try {
      if (!fs.existsSync(this.configPath)) {
        return {
          exists: false,
          lastModified: null,
          size: 0
        };
      }

      const stats = fs.statSync(this.configPath);
      return {
        exists: true,
        lastModified: stats.mtime.toISOString(),
        size: stats.size,
        path: this.configPath
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  validateConfig(config) {
    const errors = [];

    // Required fields validation
    const requiredFields = [
      { field: 'tcpIp', type: 'string', message: 'TCP IP address is required' },
      { field: 'tcpPort', type: 'number', message: 'TCP port is required' },
      { field: 'serialPath', type: 'string', message: 'Serial path is required' },
      { field: 'serialBaud', type: 'number', message: 'Serial baud rate is required' }
    ];

    for (const req of requiredFields) {
      if (!config.hasOwnProperty(req.field)) {
        errors.push(`Missing required field: ${req.field}`);
      } else if (req.type === 'number' && !Number.isInteger(config[req.field])) {
        errors.push(`${req.field} must be a number`);
      } else if (req.type === 'string' && typeof config[req.field] !== 'string') {
        errors.push(`${req.field} must be a string`);
      }
    }

    // Specific validations
    if (config.tcpPort && (config.tcpPort < 1 || config.tcpPort > 65535)) {
      errors.push('TCP port must be between 1 and 65535');
    }

    if (config.serialBaud && config.serialBaud < 1) {
      errors.push('Serial baud rate must be positive');
    }

    if (config.serialParity && !['none', 'even', 'odd', 'mark', 'space'].includes(config.serialParity)) {
      errors.push('Serial parity must be one of: none, even, odd, mark, space');
    }

    if (config.serialDataBits && ![5, 6, 7, 8].includes(config.serialDataBits)) {
      errors.push('Serial data bits must be 5, 6, 7, or 8');
    }

    if (config.serialStopBits && ![1, 1.5, 2].includes(config.serialStopBits)) {
      errors.push('Serial stop bits must be 1, 1.5, or 2');
    }

    if (config.maxRetries && config.maxRetries < 0) {
      errors.push('Max retries must be non-negative');
    }

    if (config.retryDelay && config.retryDelay < 100) {
      errors.push('Retry delay must be at least 100ms');
    }

    if (config.connectionTimeout && config.connectionTimeout < 1000) {
      errors.push('Connection timeout must be at least 1000ms');
    }

    if (config.relayTimeout && config.relayTimeout < 1000) {
      errors.push('Relay timeout must be at least 1000ms');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async backupConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        return null; // No config to backup
      }

      // Ensure backup directory exists
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `config-backup-${timestamp}.json`);

      // Copy current config to backup
      fs.copyFileSync(this.configPath, backupFile);

      // Clean up old backups (keep last 10)
      this.cleanupOldBackups();

      return backupFile;
    } catch (error) {
      throw new Error(`Failed to backup configuration: ${error.message}`);
    }
  }

  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return [];
      }

      const backupFiles = fs.readdirSync(this.backupDir)
        .filter(file => file.startsWith('config-backup-') && file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(this.backupDir, file);
          const stats = fs.statSync(filePath);
          return {
            id: file,
            name: file,
            created: stats.mtime.toISOString(),
            size: stats.size
          };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));

      return backupFiles;
    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  cleanupOldBackups(keepCount = 10) {
    try {
      const backups = this.listBackups();
      
      if (backups.length > keepCount) {
        const toDelete = backups.slice(keepCount);
        
        for (const backup of toDelete) {
          const backupPath = path.join(this.backupDir, backup.id);
          fs.unlinkSync(backupPath);
        }
      }
    } catch (error) {
      // Non-critical error, log but don't throw
      console.warn('Failed to cleanup old backups:', error.message);
    }
  }
}

module.exports = ConfigRoutes;