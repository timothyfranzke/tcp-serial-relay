#!/usr/bin/env node

// scripts/config-manager.js - Configuration management utility

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { program } = require('commander');

// Import the config path resolver
const { getConfigPath } = require('../src/config');

class ConfigManager {
  constructor() {
    this.configPath = getConfigPath(); // Use the same path resolution as the main app
    this.defaultConfigPath = path.join(__dirname, '..', 'src', 'config', 'default-config.js');
  }

  show() {
    console.log('Current Configuration:');
    console.log('====================');
    console.log(`Configuration file: ${this.configPath}`);
    console.log('');
    
    if (!fs.existsSync(this.configPath)) {
      console.log('❌ Configuration file not found');
      console.log('Run "tcp-serial-relay config --reset" to create default configuration');
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      console.log(JSON.stringify(config, null, 2));
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
    console.log(`File: ${this.configPath}`);
    
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
          field: 'connectionType',
          test: (val) => ['serial', 'tcp'].includes(val),
          message: 'Connection type must be "serial" or "tcp"'
        }
      ];

      // Connection-specific validations
      if (config.connectionType === 'serial') {
        validations.push(
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
        );
      } else if (config.connectionType === 'tcp') {
        validations.push(
          {
            field: 'secondaryTcpIp',
            test: (val) => typeof val === 'string' && val.length > 0,
            message: 'Secondary TCP IP must be a non-empty string'
          },
          {
            field: 'secondaryTcpPort',
            test: (val) => Number.isInteger(val) && val >= 1 && val <= 65535,
            message: 'Secondary TCP port must be an integer between 1 and 65535'
          }
        );
      }

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

      // Check for port conflicts in TCP mode
      if (config.connectionType === 'tcp' && 
          config.tcpIp === config.secondaryTcpIp && 
          config.tcpPort === config.secondaryTcpPort) {
        errors.push('Primary and secondary TCP endpoints cannot be the same');
        isValid = false;
      }

      if (isValid) {
        console.log('✅ Configuration is valid');
        console.log('\nConfiguration Summary:');
        console.log(`  Connection Type: ${config.connectionType}`);
        console.log(`  Primary TCP: ${config.tcpIp}:${config.tcpPort}`);
        
        if (config.connectionType === 'serial') {
          console.log(`  Serial Port: ${config.serialPath} @ ${config.serialBaud} baud`);
          console.log(`  Serial Settings: ${config.serialDataBits}${config.serialParity.charAt(0).toUpperCase()}${config.serialStopBits}`);
        } else if (config.connectionType === 'tcp') {
          console.log(`  Secondary TCP: ${config.secondaryTcpIp}:${config.secondaryTcpPort}`);
        }
        
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
    console.log(`Target file: ${this.configPath}`);
    
    try {
      // Load default configuration
      delete require.cache[require.resolve(this.defaultConfigPath)];
      const defaultConfig = require(this.defaultConfigPath);
      
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
        console.log(`Created directory: ${configDir}`);
      }

      // Write default configuration
      fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      
      console.log('✅ Default configuration created');
      console.log('\nNext steps:');
      console.log('1. Edit the configuration: tcp-serial-relay config --edit');
      console.log('2. Validate: tcp-serial-relay config --validate');
      console.log('3. Test connections: tcp-serial-relay test');

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

  info() {
    console.log('Configuration Information:');
    console.log('=========================');
    console.log(`Config path: ${this.configPath}`);
    console.log(`Config exists: ${fs.existsSync(this.configPath) ? 'Yes' : 'No'}`);
    
    if (fs.existsSync(this.configPath)) {
      const stats = fs.statSync(this.configPath);
      console.log(`Last modified: ${stats.mtime.toISOString()}`);
      console.log(`File size: ${stats.size} bytes`);
    }
    
    console.log(`Default config: ${this.defaultConfigPath}`);
    console.log('');
    
    // Show environment variables that affect config
    const envVars = [
      'CONFIG_PATH',
      'TCP_IP',
      'TCP_PORT',
      'CONNECTION_TYPE',
      'SERIAL_PATH',
      'SERIAL_BAUD',
      'SECONDARY_TCP_IP',
      'SECONDARY_TCP_PORT'
    ];
    
    const setVars = envVars.filter(name => process.env[name]);
    if (setVars.length > 0) {
      console.log('Environment overrides:');
      setVars.forEach(name => {
        console.log(`  ${name}=${process.env[name]}`);
      });
    } else {
      console.log('No environment variable overrides set');
    }
  }

  template() {
    const template = {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "TCP-Serial/TCP Relay Configuration",
      "type": "object",
      "properties": {
        "connectionType": {
          "type": "string",
          "enum": ["serial", "tcp"],
          "description": "Type of secondary connection",
          "default": "serial"
        },
        "tcpIp": {
          "type": "string",
          "description": "Primary TCP server IP address",
          "default": "192.168.1.90"
        },
        "tcpPort": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535,
          "description": "Primary TCP server port",
          "default": 10002
        },
        "serialPath": {
          "type": "string",
          "description": "Serial port device path (when connectionType is 'serial')",
          "default": "/dev/ttyUSB0"
        },
        "serialBaud": {
          "type": "integer",
          "minimum": 1,
          "description": "Serial port baud rate (when connectionType is 'serial')",
          "default": 9600
        },
        "serialParity": {
          "type": "string",
          "enum": ["none", "even", "odd", "mark", "space"],
          "description": "Serial port parity (when connectionType is 'serial')",
          "default": "odd"
        },
        "serialDataBits": {
          "type": "integer",
          "enum": [5, 6, 7, 8],
          "description": "Serial port data bits (when connectionType is 'serial')",
          "default": 7
        },
        "serialStopBits": {
          "type": "number",
          "enum": [1, 1.5, 2],
          "description": "Serial port stop bits (when connectionType is 'serial')",
          "default": 1
        },
        "secondaryTcpIp": {
          "type": "string",
          "description": "Secondary TCP server IP address (when connectionType is 'tcp')",
          "default": "192.168.1.91"
        },
        "secondaryTcpPort": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535,
          "description": "Secondary TCP server port (when connectionType is 'tcp')",
          "default": 10003
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
        "connectionType",
        "tcpIp",
        "tcpPort"
      ],
      "if": {
        "properties": { "connectionType": { "const": "serial" } }
      },
      "then": {
        "required": ["serialPath", "serialBaud", "serialParity", "serialDataBits", "serialStopBits"]
      },
      "else": {
        "required": ["secondaryTcpIp", "secondaryTcpPort"]
      }
    };

    console.log('Configuration Template:');
    console.log('======================');
    console.log(JSON.stringify(template, null, 2));
  }
}

// CLI setup
program
  .name('config-manager')
  .description('TCP-Serial/TCP Relay configuration management')
  .version('1.0.0');

program
  .option('--show', 'Show current configuration')
  .option('--edit', 'Edit configuration file')
  .option('--validate [file]', 'Validate configuration')
  .option('--reset', 'Reset to default configuration')
  .option('--backup', 'Backup current configuration')
  .option('--restore <file>', 'Restore from backup file')
  .option('--info', 'Show configuration file information')
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
    } else if (options.info) {
      manager.info();
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