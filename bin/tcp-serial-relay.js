#!/usr/bin/env node

// bin/tcp-serial-relay.js - CLI entry point for the npm package

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const { exec, spawn, execSync } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const program = new Command();

// Package info
const packagePath = path.join(__dirname, '..', 'package.json');
const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

program
  .name('tcp-serial-relay')
  .description('TCP to Serial/TCP relay service for Raspberry Pi')
  .version(packageInfo.version);

// Start command
program
  .command('start')
  .description('Start the relay service')
  .option('-c, --config <path>', 'Configuration file path')
  .option('-d, --daemon', 'Run as daemon')
  .option('--mock', 'Run in mock mode for testing')
  .option('--debug', 'Enable debug logging')
  .option('--tcp', 'Force TCP-to-TCP mode')
  .option('--serial', 'Force TCP-to-Serial mode')
  .action(async (options) => {
    const appPath = path.join(__dirname, '..', 'src', 'app.js');
    const env = { ...process.env };
    
    if (options.config) {
      env.CONFIG_PATH = options.config;
    }
    
    if (options.mock) {
      env.MOCK_ENV = 'true';
      env.LOG_LEVEL = 'debug';
    }
    
    if (options.debug) {
      env.LOG_LEVEL = 'debug';
    }

    if (options.tcp) {
      env.CONNECTION_TYPE = 'tcp';
      console.log('Forcing TCP-to-TCP relay mode');
    }

    if (options.serial) {
      env.CONNECTION_TYPE = 'serial';
      console.log('Forcing TCP-to-Serial relay mode');
    }
    
    if (options.daemon) {
      // Run as daemon (detached process)
      const child = spawn('node', [appPath], {
        detached: true,
        stdio: 'ignore',
        env
      });
      child.unref();
      console.log(`Service started as daemon with PID: ${child.pid}`);
    } else {
      // Run in foreground
      spawn('node', [appPath], {
        stdio: 'inherit',
        env
      });
    }
  });

// Stop command
program
  .command('stop')
  .description('Stop the relay service')
  .action(async () => {
    try {
      const { stdout } = await execAsync("pgrep -f 'node.*tcp-serial-relay'");
      const pids = stdout.trim().split('\n').filter(Boolean);
      
      if (pids.length === 0) {
        console.log('No running relay services found');
        return;
      }
      
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), 'SIGTERM');
          console.log(`Stopped service with PID: ${pid}`);
        } catch (error) {
          console.warn(`Could not stop PID ${pid}: ${error.message}`);
        }
      }
    } catch (error) {
      console.log('No running relay services found');
    }
  });

// Status command
program
  .command('status')
  .description('Check service status')
  .action(async () => {
    try {
      const { stdout } = await execAsync("pgrep -f 'node.*tcp-serial-relay'");
      const pids = stdout.trim().split('\n').filter(Boolean);
      
      if (pids.length === 0) {
        console.log('Service is not running');
        process.exit(1);
      } else {
        console.log(`Service is running (PIDs: ${pids.join(', ')})`);
        process.exit(0);
      }
    } catch (error) {
      console.log('Service is not running');
      process.exit(1);
    }
  });

// Setup command
program
  .command('setup')
  .description('Setup service on Raspberry Pi')
  .option('--user <user>', 'Service user', 'relay')
  .option('--no-cron', 'Skip cron setup')
  .option('--no-systemd', 'Skip systemd service setup')
  .action(async (options) => {
    const setupScript = path.join(__dirname, '..', 'scripts', 'setup.js');
    
    const args = [];
    if (!options.cron) args.push('--no-cron');
    if (!options.systemd) args.push('--no-systemd');
    if (options.user) args.push('--user', options.user);
    
    spawn('node', [setupScript, ...args], {
      stdio: 'inherit'
    });
  });

// Health check command
program
  .command('health')
  .description('Run health check')
  .option('-f, --format <format>', 'Output format (console|json|summary|prometheus)', 'summary')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    const healthScript = path.join(__dirname, '..', 'scripts', 'health-check.js');
    
    const args = [options.format];
    if (options.verbose) args.push('--verbose');
    
    spawn('node', [healthScript, ...args], {
      stdio: 'inherit'
    });
  });

// List ports command
program
  .command('list-ports')
  .description('List available serial ports')
  .action(async () => {
    const listScript = path.join(__dirname, '..', 'scripts', 'list-ports.js');
    spawn('node', [listScript], {
      stdio: 'inherit'
    });
  });

// Config command
program
  .command('config')
  .description('Manage configuration')
  .option('--show', 'Show current configuration')
  .option('--edit', 'Edit configuration file')
  .option('--reset', 'Reset to default configuration')
  .option('--validate', 'Validate configuration')
  .option('--set-tcp', 'Set connection type to TCP')
  .option('--set-serial', 'Set connection type to Serial')
  .action(async (options) => {
    if (options.setTcp || options.setSerial) {
      // Handle connection type changes
      const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'relay-config.json');
      
      try {
        let config = {};
        if (fs.existsSync(configPath)) {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        
        if (options.setTcp) {
          config.connectionType = 'tcp';
          console.log('Set connection type to TCP');
          
          // Set default secondary TCP settings if not present
          if (!config.secondaryTcpIp) config.secondaryTcpIp = '192.168.1.91';
          if (!config.secondaryTcpPort) config.secondaryTcpPort = 10003;
        }
        
        if (options.setSerial) {
          config.connectionType = 'serial';
          console.log('Set connection type to Serial');
          
          // Set default serial settings if not present
          if (!config.serialPath) config.serialPath = '/dev/ttyUSB0';
          if (!config.serialBaud) config.serialBaud = 9600;
        }
        
        // Ensure config directory exists
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log(`Configuration updated: ${configPath}`);
        console.log('Run "tcp-serial-relay config --show" to view the current configuration');
        
      } catch (error) {
        console.error('Failed to update configuration:', error.message);
        process.exit(1);
      }
      return;
    }
    
    const configScript = path.join(__dirname, '..', 'scripts', 'config-manager.js');
    
    const args = [];
    if (options.show) args.push('--show');
    if (options.edit) args.push('--edit');
    if (options.reset) args.push('--reset');
    if (options.validate) args.push('--validate');
    
    spawn('node', [configScript, ...args], {
      stdio: 'inherit'
    });
  });

// Logs command
program
  .command('logs')
  .description('View service logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('--error', 'Show error logs only')
  .option('--data', 'Show data transfer logs')
  .action(async (options) => {
    const logsScript = path.join(__dirname, '..', 'scripts', 'view-logs.js');
    
    const args = [];
    if (options.follow) args.push('--follow');
    if (options.lines) args.push('--lines', options.lines);
    if (options.error) args.push('--error');
    if (options.data) args.push('--data');
    
    spawn('node', [logsScript, ...args], {
      stdio: 'inherit'
    });
  });

// Install service command
program
  .command('install-service')
  .description('Install as system service')
  .option('--systemd', 'Install as systemd service')
  .option('--cron', 'Install as cron job')
  .option('--user <user>', 'Service user', 'relay')
  .action(async (options) => {
    const installScript = path.join(__dirname, '..', 'scripts', 'install-service.js');
    
    const args = [];
    if (options.systemd) args.push('--systemd');
    if (options.cron) args.push('--cron');
    if (options.user) args.push('--user', options.user);
    
    spawn('node', [installScript, ...args], {
      stdio: 'inherit'
    });
  });

// Uninstall service command
program
  .command('uninstall-service')
  .description('Uninstall system service')
  .action(async () => {
    const uninstallScript = path.join(__dirname, '..', 'scripts', 'uninstall-service.js');
    spawn('node', [uninstallScript], {
      stdio: 'inherit'
    });
  });

// Update command to run the update.js script
program
  .command('update')
  .description('Update to latest version')
  .action(async () => {
    const updateScript = path.join(__dirname, '..', 'scripts', 'update.js');
    spawn('node', [updateScript], { stdio: 'inherit' });
  });

// Auto-update management command
program
  .command('auto-update')
  .description('Manage automatic updates')
  .option('--enable', 'Enable automatic updates')
  .option('--disable', 'Disable automatic updates')
  .option('--status', 'Show auto-update status')
  .option('--fix', 'Fix auto-update configuration')
  .option('--policy <policy>', 'Update policy (patch|minor|major)', 'minor')
  .option('--schedule <schedule>', 'Cron schedule', '0 3 * * *')
  .action(async (options) => {
    const updateScript = path.join(__dirname, '..', 'scripts', 'update-manager.js');
    
    if (options.enable) {
      const args = ['enable-auto', '--policy', options.policy, '--schedule', options.schedule];
      spawn('node', [updateScript, ...args], { stdio: 'inherit' });
    } else if (options.disable) {
      spawn('node', [updateScript, 'disable-auto'], { stdio: 'inherit' });
    } else if (options.fix) {
      spawn('node', [updateScript, 'fix'], { stdio: 'inherit' });
    } else {
      // Default: show status
      spawn('node', [updateScript, 'status'], { stdio: 'inherit' });
    }
  });

// Test connection command
program
  .command('test')
  .description('Test connection configuration')
  .option('-c, --config <path>', 'Configuration file path')
  .option('--tcp', 'Test TCP-to-TCP configuration')
  .option('--serial', 'Test TCP-to-Serial configuration')
  .option('--timeout <seconds>', 'Test timeout in seconds', '10')
  .action(async (options) => {
    const testScript = path.join(__dirname, '..', 'scripts', 'test-connection.js');
    
    const args = [];
    if (options.config) args.push('--config', options.config);
    if (options.tcp) args.push('--tcp');
    if (options.serial) args.push('--serial');
    if (options.timeout) args.push('--timeout', options.timeout);
    
    spawn('node', [testScript, ...args], {
      stdio: 'inherit'
    });
  });

// Clean dashboard command for bin/tcp-serial-relay.js
// Replace the existing dashboard command with this:

program
  .command('dashboard')
  .description('Start the web dashboard')
  .option('-p, --port <port>', 'Dashboard port', '3000')
  .option('--host <host>', 'Dashboard host', '0.0.0.0')
  .option('-c, --config <path>', 'Configuration file path')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    console.log('🚀 Starting TCP-Serial Relay Dashboard...');
    
    try {
      // Define paths
      const dashboardDir = path.join(__dirname, '..', 'src', 'dashboard');
      const dashboardServerPath = path.join(dashboardDir, 'server.js');
      
      // Verify dashboard server exists
      if (!fs.existsSync(dashboardServerPath)) {
        console.error('❌ Dashboard server not found:', dashboardServerPath);
        console.error('');
        console.error('Expected file: src/dashboard/server.js');
        process.exit(1);
      }
      
      // Set environment variables
      const env = { 
        ...process.env,
        PORT: options.port,
        DASHBOARD_PORT: options.port,
        HOST: options.host,
        NODE_ENV: options.debug ? 'development' : 'production'
      };
      
      if (options.config) {
        env.CONFIG_PATH = options.config;
      }
      
      if (options.debug) {
        env.LOG_LEVEL = 'debug';
      }
      
      // Display startup info
      console.log(`🌐 Starting dashboard on port ${options.port}`);
      console.log(`🔗 URL: http://localhost:${options.port}`);
      if (options.config) {
        console.log(`⚙️  Config: ${options.config}`);
      }
      console.log('');
      
      // Start the dashboard server
      const child = spawn('node', [dashboardServerPath], {
        stdio: 'inherit',
        env,
        cwd: dashboardDir
      });
      
      // Handle process events
      child.on('error', (error) => {
        console.error('❌ Dashboard process error:', error.message);
        process.exit(1);
      });
      
      child.on('exit', (code, signal) => {
        if (signal) {
          console.log(`\n🛑 Dashboard stopped by signal: ${signal}`);
        } else if (code !== 0) {
          console.error(`❌ Dashboard exited with code ${code}`);
          process.exit(code);
        }
      });
      
      // Handle SIGINT (Ctrl+C) to gracefully shut down
      process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down dashboard...');
        child.kill('SIGTERM');
        
        // Force exit after 3 seconds if graceful shutdown fails
        setTimeout(() => {
          child.kill('SIGKILL');
          process.exit(0);
        }, 3000);
      });
      
    } catch (error) {
      console.error('❌ Failed to start dashboard:', error.message);
      process.exit(1);
    }
  });


// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}