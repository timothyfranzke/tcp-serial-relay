#!/usr/bin/env node

// bin/tcp-serial-relay.js - CLI entry point for the npm package

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const program = new Command();

// Package info
const packagePath = path.join(__dirname, '..', 'package.json');
const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

program
  .name('tcp-serial-relay')
  .description('TCP to Serial relay service for Raspberry Pi')
  .version(packageInfo.version);

// Start command
program
  .command('start')
  .description('Start the relay service')
  .option('-c, --config <path>', 'Configuration file path')
  .option('-d, --daemon', 'Run as daemon')
  .option('--mock', 'Run in mock mode for testing')
  .option('--debug', 'Enable debug logging')
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
  .action(async (options) => {
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

// Update command with enhanced auto-update features
program
  .command('update')
  .description('Update to latest version')
  .option('--check', 'Check for updates without installing')
  .option('--auto', 'Enable automatic updates')
  .option('--policy <policy>', 'Update policy for auto-updates (patch|minor|major)', 'minor')
  .option('--schedule <schedule>', 'Cron schedule for auto-updates', '0 3 * * *')
  .action(async (options) => {
    const updateScript = path.join(__dirname, '..', 'scripts', 'update-manager.js');
    
    if (options.auto) {
      // Enable automatic updates
      const args = ['enable-auto', '--policy', options.policy, '--schedule', options.schedule];
      spawn('node', [updateScript, ...args], { stdio: 'inherit' });
    } else if (options.check) {
      // Check for updates
      spawn('node', [updateScript, 'check'], { stdio: 'inherit' });
    } else {
      // Perform update
      spawn('node', [updateScript, 'update'], { stdio: 'inherit' });
    }
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

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}