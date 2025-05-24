#!/usr/bin/env node

// scripts/config-manager.js - Configuration management utility

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { program } = require('commander');

class ConfigManager {
  constructor() {
    this.configPath = process.env.CONFIG_PATH || '/etc/tcp-serial-relay/relay-config.json';
    this.defaultConfigPath = path.join(__dirname, '..', 'src', 'config', 'default-config.js');
  }

  show() {
    console.log('Current Configuration:');
    console.log('====================');
    
    if (!fs.existsSync(this.configPath)) {
      console.log('❌ Configuration file not found:', this.configPath);
      console.log('Run "tcp-serial-relay config --reset" to create default configuration');
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      console.log(JSON.stringify(config, null, 2));
      console.log('\nConfiguration file:', this.configPath);
    } catch (error) {
      console.error('❌ Error reading configuration:', error.message);
    }
  }

  edit() {
    if (!fs.existsSync(this.configPath)) {
      console.log('Configuration file not found. Creating default configuration...');
      this.reset();
    }

    const editor = process.env.EDITOR || 'nano';
    console.log(`Opening configuration file with ${editor}...`);
    
    const child = spawn(editor, [this.configPath], {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('Configuration file saved. Validating...');
        this.validate();
      } else {
        console.log('Editor exited with code:', code);
      }
    });
  }

  validate(configFile = null) {
    const targetFile = configFile || this.configPath;
    
    console.log('Validating configuration...');
    console.log('File:', targetFile);
    
    if (!fs.existsSync(targetFile)) {
      console.log('❌ Configuration file not found');
      return false;
    }

    try {
      const config = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      
      // Validation rules
      const validations = [
        {
          field: 'tcpIp',
          test: (val) => typeof val === 'string' && val.length > 0,
          message: 'TCP IP must be a non-empty string'
        },
        {
          field: 'tcpPort',
          test: (val) => Number.isInteger(val) && val >= 1 && val <= 65535,
          message: 'TCP port must be an integer between 1 and 65535'
        },
        {
          field: 'serialPath',
          test: (val) => typeof val === 'string' && val.length > 0,
          message: 'Serial path must be a non-empty string'
        },
        {
          field: 'serialBaud',
          test: (val) => Number.isInteger(val) && val > 0,
          message: 'Serial baud rate must be a positive integer'
        },
        {
          field: 'serialParity',
          test: (val) => ['none', 'even', 'odd', 'mark', 'space'].includes(val),
          message: 'Serial parity must be one of: none, even, odd, mark, space'
        },
        {
          field: 'serialDataBits',
          test: (val) => [5, 6, 7, 8].includes(val),
          message: 'Serial data bits must be 5, 6, 7, or 8'
        },
        {
          field: 'serialStopBits',
          test: (val) => [1, 1.5, 2].includes(val),
          message: 'Serial stop bits must be 1, 1.5, or 2'
        }
      ];

      let isValid = true;
      const errors = [];

      for (const validation of validations) {
        if (!config.hasOwnProperty(validation.field)) {
          errors.push(`Missing required field: ${validation.field}`);
          isValid = false;
        } else if (!validation.test(config[validation.field])) {
          errors.push(`${validation.field}: ${validation.message}`);
          isValid = false;
        }
      }

      if (isValid) {
        console.log('✅ Configuration is valid');
        console.log('\nConfiguration Summary:');
        console.log(`  TCP Endpoint: ${config.tcpIp}:${config.tcpPort}`);
        console.log(`  Serial Port: ${config.serialPath} @ ${config.serialBaud} baud`);
        console.log(`  Serial Settings: ${config.serialDataBits}${config.serialParity.charAt(0).toUpperCase()}${config.serialStopBits}`);
        console.log(`  Log Level: ${config.logLevel || 'info'}`);
        return true;
      } else {
        console.log('❌ Configuration validation failed:');
        errors.forEach(error => console.log(`  - ${error}`));
        return false;
      }

    } catch (error) {
      console.log('❌ Configuration parsing failed:', error.message);
      return false;
    }
  }

  reset() {
    console.log('Resetting configuration to defaults...');
    
    try {
      // Load default configuration
      const defaultConfig = require(this.defaultConfigPath);
      
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Write default configuration
      fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      
      console.log('✅ Default configuration created');
      console.log('File:', this.configPath);
      console.log('\nNext steps:');
      console.log('1. Edit the configuration: tcp-serial-relay config --edit');
      console.log('2. Validate: tcp-serial-relay config --validate');

    } catch (error) {
      console.error('❌ Failed to reset configuration:', error.message);
    }
  }

  backup() {
    if (!fs.existsSync(this.configPath)) {
      console.log('❌ No configuration file to backup');
      return;
    }

    const backupDir = path.join(path.dirname(this.configPath), 'backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `relay-config-${timestamp}.json`);

    try {
      // Ensure backup directory exists
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Copy configuration file
      fs.copyFileSync(this.configPath, backupFile);
      
      console.log('✅ Configuration backed up');
      console.log('Backup file:', backupFile);

    } catch (error) {
      console.error('❌ Failed to backup configuration:', error.message);
    }
  }

  restore(backupFile) {
    if (!fs.existsSync(backupFile)) {
      console.log('❌ Backup file not found:', backupFile);
      
      // List available backups
      const backupDir = path.join(path.dirname(this.configPath), 'backups');
      if (fs.existsSync(backupDir)) {
        const backups = fs.readdirSync(backupDir)
          .filter(file => file.endsWith('.json'))
          .sort()
          .reverse();
        
        if (backups.length > 0) {
          console.log('\nAvailable backups:');
          backups.forEach(backup => {
            const backupPath = path.join(backupDir, backup);
            const stats = fs.statSync(backupPath);
            console.log(`  ${backup} (${stats.mtime.toISOString()})`);
          });
        } else {
          console.log('No backup files found');
        }
      }
      return;
    }

    try {
      // Validate backup file first
      if (!this.validate(backupFile)) {
        console.log('❌ Backup file is invalid, cannot restore');
        return;
      }

      // Backup current config before restoring
      this.backup();

      // Restore from backup
      fs.copyFileSync(backupFile, this.configPath);
      
      console.log('✅ Configuration restored from backup');
      console.log('Restored from:', backupFile);
      console.log('Current config:', this.configPath);

    } catch (error) {
      console.error('❌ Failed to restore configuration:', error.message);
    }
  }

  template() {
    const template = {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "TCP-Serial Relay Configuration",
      "type": "object",
      "properties": {
        "tcpIp": {
          "type": "string",
          "description": "TCP server IP address",
          "default": "192.168.1.90"
        },
        "tcpPort": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535,
          "description": "TCP server port",
          "default": 10002
        },
        "serialPath": {
          "type": "string",
          "description": "Serial port device path",
          "default": "/dev/ttyUSB0"
        },
        "serialBaud": {
          "type": "integer",
          "minimum": 1,
          "description": "Serial port baud rate",
          "default": 9600
        },
        "serialParity": {
          "type": "string",
          "enum": ["none", "even", "odd", "mark", "space"],
          "description": "Serial port parity",
          "default": "odd"
        },
        "serialDataBits": {
          "type": "integer",
          "enum": [5, 6, 7, 8],
          "description": "Serial port data bits",
          "default": 7
        },
        "serialStopBits": {
          "type": "number",
          "enum": [1, 1.5, 2],
          "description": "Serial port stop bits",
          "default": 1
        },
        "maxRetries": {
          "type": "integer",
          "minimum": 0,
          "description": "Maximum connection retry attempts",
          "default": 3
        },
        "retryDelay": {
          "type": "integer",
          "minimum": 100,
          "description": "Delay between retry attempts (ms)",
          "default": 5000
        },
        "connectionTimeout": {
          "type": "integer",
          "minimum": 1000,
          "description": "Connection timeout (ms)",
          "default": 10000
        },
        "relayTimeout": {
          "type": "integer",
          "minimum": 1000,
          "description": "Maximum time to wait for data (ms)",
          "default": 30000
        },
        "logDataTransfers": {
          "type": "boolean",
          "description": "Log individual data transfers",
          "default": true
        },
        "logLevel": {
          "type": "string",
          "enum": ["error", "warn", "info", "debug", "silly"],
          "description": "Logging level",
          "default": "info"
        }
      },
      "required": [
        "tcpIp",
        "tcpPort", 
        "serialPath",
        "serialBaud",
        "serialParity",
        "serialDataBits",
        "serialStopBits"
      ]
    };

    console.log('Configuration Template:');
    console.log('======================');
    console.log(JSON.stringify(template, null, 2));
  }
}

// CLI setup
program
  .name('config-manager')
  .description('TCP-Serial Relay configuration management')
  .version('1.0.0');

program
  .option('--show', 'Show current configuration')
  .option('--edit', 'Edit configuration file')
  .option('--validate [file]', 'Validate configuration')
  .option('--reset', 'Reset to default configuration')
  .option('--backup', 'Backup current configuration')
  .option('--restore <file>', 'Restore from backup file')
  .option('--template', 'Show configuration template/schema')
  .action((options) => {
    const manager = new ConfigManager();

    if (options.show) {
      manager.show();
    } else if (options.edit) {
      manager.edit();
    } else if (options.validate !== undefined) {
      const file = typeof options.validate === 'string' ? options.validate : null;
      manager.validate(file);
    } else if (options.reset) {
      manager.reset();
    } else if (options.backup) {
      manager.backup();
    } else if (options.restore) {
      manager.restore(options.restore);
    } else if (options.template) {
      manager.template();
    } else {
      program.help();
    }
  });

program.parse(process.argv);

// Show help if no options provided
if (process.argv.length <= 2) {
  program.help();
}

module.exports = ConfigManager;