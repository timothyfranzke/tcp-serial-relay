#!/usr/bin/env node

// scripts/debug-config.js - Debug configuration path resolution

const fs = require('fs');
const path = require('path');
const os = require('os');

function debugConfigPaths() {
  console.log('TCP-Serial Relay Configuration Debug');
  console.log('===================================\n');

  // Check all possible config paths
  const configPaths = [
    {
      name: 'Environment Variable (CONFIG_PATH)',
      path: process.env.CONFIG_PATH,
      priority: 1
    },
    {
      name: 'System Config',
      path: '/etc/tcp-serial-relay/relay-config.json',
      priority: 2
    },
    {
      name: 'Local Config (CWD)',
      path: path.join(process.cwd(), 'config', 'relay-config.json'),
      priority: 3
    },
    {
      name: 'Home Directory Config',
      path: path.join(os.homedir(), '.tcp-serial-relay', 'relay-config.json'),
      priority: 4
    }
  ];

  console.log('Configuration Path Resolution Order:');
  console.log('====================================');

  let activeConfigPath = null;
  
  configPaths.forEach((config, index) => {
    const exists = config.path ? fs.existsSync(config.path) : false;
    const readable = exists ? (() => {
      try {
        fs.accessSync(config.path, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    })() : false;
    
    const writable = exists ? (() => {
      try {
        fs.accessSync(config.path, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    })() : false;

    const status = !config.path ? 'Not Set' :
                  !exists ? 'Does Not Exist' :
                  !readable ? 'Not Readable' :
                  !writable ? 'Read Only' : 'OK';

    console.log(`${index + 1}. ${config.name}`);
    console.log(`   Path: ${config.path || 'undefined'}`);
    console.log(`   Status: ${status}`);
    
    if (exists && readable) {
      try {
        const content = fs.readFileSync(config.path, 'utf8');
        const parsed = JSON.parse(content);
        console.log(`   Content: Valid JSON (${Object.keys(parsed).length} keys)`);
        console.log(`   Connection Type: ${parsed.connectionType || 'not set'}`);
        
        if (!activeConfigPath) {
          activeConfigPath = config.path;
          console.log(`   >>> THIS WILL BE USED <<<`);
        }
      } catch (error) {
        console.log(`   Content: Invalid JSON - ${error.message}`);
      }
    }
    console.log('');
  });

  // Show which config would actually be used
  console.log('Actual Resolution Result:');
  console.log('========================');
  
  try {
    // Import the actual config path resolver
    const configIndexPath = path.join(__dirname, '..', 'src', 'config', 'index.js');
    if (fs.existsSync(configIndexPath)) {
      delete require.cache[require.resolve(configIndexPath)];
      const { getConfigPath } = require(configIndexPath);
      const resolvedPath = getConfigPath();
      
      console.log(`Resolved config path: ${resolvedPath}`);
      console.log(`Path exists: ${fs.existsSync(resolvedPath)}`);
      
      if (fs.existsSync(resolvedPath)) {
        try {
          const content = fs.readFileSync(resolvedPath, 'utf8');
          const config = JSON.parse(content);
          console.log(`Configuration preview:`);
          console.log(`  Connection Type: ${config.connectionType}`);
          console.log(`  Primary TCP: ${config.tcpIp}:${config.tcpPort}`);
          
          if (config.connectionType === 'tcp') {
            console.log(`  Secondary TCP: ${config.secondaryTcpIp}:${config.secondaryTcpPort}`);
          } else if (config.connectionType === 'serial') {
            console.log(`  Serial: ${config.serialPath} @ ${config.serialBaud}`);
          }
        } catch (error) {
          console.log(`Error reading config: ${error.message}`);
        }
      }
    } else {
      console.log('Config resolver not found - using fallback logic');
      const fallbackPath = process.env.CONFIG_PATH || 
                          (fs.existsSync('/etc/tcp-serial-relay/relay-config.json') ? 
                           '/etc/tcp-serial-relay/relay-config.json' :
                           path.join(process.cwd(), 'config', 'relay-config.json'));
      console.log(`Fallback path: ${fallbackPath}`);
    }
  } catch (error) {
    console.log(`Error resolving config path: ${error.message}`);
  }

  console.log('\nEnvironment Variables:');
  console.log('=====================');
  const envVars = [
    'CONFIG_PATH',
    'NODE_ENV',
    'TCP_IP',
    'TCP_PORT',
    'CONNECTION_TYPE',
    'SERIAL_PATH',
    'SERIAL_BAUD',
    'SECONDARY_TCP_IP',
    'SECONDARY_TCP_PORT'
  ];

  envVars.forEach(varName => {
    const value = process.env[varName];
    console.log(`${varName}: ${value || '(not set)'}`);
  });

  console.log('\nPermissions Check:');
  console.log('==================');
  
  // Check directory permissions for creating config files
  const testDirs = [
    process.cwd(),
    path.join(process.cwd(), 'config'),
    os.homedir(),
    path.join(os.homedir(), '.tcp-serial-relay'),
    '/etc/tcp-serial-relay'
  ];

  testDirs.forEach(dir => {
    const exists = fs.existsSync(dir);
    let canWrite = false;
    
    if (exists) {
      try {
        const testFile = path.join(dir, '.test-write-' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        canWrite = true;
      } catch {
        canWrite = false;
      }
    }

    console.log(`${dir}:`);
    console.log(`  Exists: ${exists}`);
    console.log(`  Writable: ${canWrite}`);
  });

  console.log('\nRecommendations:');
  console.log('================');
  
  if (activeConfigPath) {
    console.log(`✅ Configuration file found at: ${activeConfigPath}`);
    console.log('   This file will be used by the relay service.');
  } else {
    console.log('❌ No configuration file found.');
    console.log('   Run: tcp-serial-relay config --reset');
    console.log('   Then: tcp-serial-relay config --edit');
  }

  // Check if there are multiple config files that might cause confusion
  const existingConfigs = configPaths.filter(c => c.path && fs.existsSync(c.path));
  if (existingConfigs.length > 1) {
    console.log('\n⚠️  Multiple configuration files found:');
    existingConfigs.forEach(config => {
      console.log(`   ${config.path}`);
    });
    console.log('   Only the highest priority one will be used.');
    console.log('   Consider removing or consolidating the others.');
  }
}

function fixPermissions() {
  console.log('Attempting to fix configuration permissions...\n');
  
  const configDir = path.join(process.cwd(), 'config');
  const configFile = path.join(configDir, 'relay-config.json');
  
  try {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      console.log(`✅ Created directory: ${configDir}`);
    }
    
    // Create default config file if it doesn't exist
    if (!fs.existsSync(configFile)) {
      const defaultConfigPath = path.join(__dirname, '..', 'src', 'config', 'default-config.js');
      if (fs.existsSync(defaultConfigPath)) {
        delete require.cache[require.resolve(defaultConfigPath)];
        const defaultConfig = require(defaultConfigPath);
        fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2), 'utf8');
        console.log(`✅ Created default config: ${configFile}`);
      }
    }
    
    // Test read/write access
    const testContent = fs.readFileSync(configFile, 'utf8');
    fs.writeFileSync(configFile, testContent, 'utf8');
    console.log(`✅ Configuration file is readable and writable`);
    
  } catch (error) {
    console.log(`❌ Failed to fix permissions: ${error.message}`);
    
    // Try alternative location
    const homeConfigDir = path.join(os.homedir(), '.tcp-serial-relay');
    const homeConfigFile = path.join(homeConfigDir, 'relay-config.json');
    
    try {
      if (!fs.existsSync(homeConfigDir)) {
        fs.mkdirSync(homeConfigDir, { recursive: true });
        console.log(`✅ Created alternative directory: ${homeConfigDir}`);
      }
      
      if (!fs.existsSync(homeConfigFile)) {
        const defaultConfigPath = path.join(__dirname, '..', 'src', 'config', 'default-config.js');
        if (fs.existsSync(defaultConfigPath)) {
          delete require.cache[require.resolve(defaultConfigPath)];
          const defaultConfig = require(defaultConfigPath);
          fs.writeFileSync(homeConfigFile, JSON.stringify(defaultConfig, null, 2), 'utf8');
          console.log(`✅ Created alternative config: ${homeConfigFile}`);
        }
      }
    } catch (altError) {
      console.log(`❌ Alternative location also failed: ${altError.message}`);
    }
  }
}

// Command line interface
const command = process.argv[2];

switch (command) {
  case 'debug':
  case undefined:
    debugConfigPaths();
    break;
    
  case 'fix':
    fixPermissions();
    break;
    
  case 'help':
  default:
    console.log('TCP-Serial Relay Configuration Debug Tool');
    console.log('=========================================');
    console.log('');
    console.log('Usage:');
    console.log('  node debug-config.js [command]');
    console.log('');
    console.log('Commands:');
    console.log('  debug    Show configuration path resolution (default)');
    console.log('  fix      Attempt to fix configuration permissions');
    console.log('  help     Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node debug-config.js');
    console.log('  node debug-config.js debug');
    console.log('  node debug-config.js fix');
    break;
}

module.exports = { debugConfigPaths, fixPermissions };