#!/usr/bin/env node

// scripts/update-manager.js - Enhanced update management built into CLI

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

class UpdateManager {
  constructor() {
    this.packageName = '@yourcompany/tcp-serial-relay';
    this.configPath = '/etc/tcp-serial-relay/relay-config.json';
    this.updateConfigPath = '/etc/tcp-serial-relay/auto-update.json';
    this.lockFile = '/tmp/tcp-relay-update.lock';
  }

  /**
   * Check for available updates
   */
  async checkForUpdates() {
    try {
      console.log('Checking for updates...');
      
      const currentVersion = await this.getCurrentVersion();
      const latestVersion = await this.getLatestVersion();
      
      console.log(`Current version: ${currentVersion}`);
      console.log(`Latest version: ${latestVersion}`);
      
      if (this.isUpdateAvailable(currentVersion, latestVersion)) {
        console.log('✅ Update available!');
        console.log(`Run 'tcp-serial-relay update' to install version ${latestVersion}`);
        return true;
      } else {
        console.log('✅ Already running the latest version');
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to check for updates:', error.message);
      return false;
    }
  }

  /**
   * Perform package update
   */
  async performUpdate() {
    if (await this.isUpdateInProgress()) {
      console.log('Update already in progress');
      return false;
    }

    try {
      await this.createLockFile();
      
      const currentVersion = await this.getCurrentVersion();
      const latestVersion = await this.getLatestVersion();
      
      if (!this.isUpdateAvailable(currentVersion, latestVersion)) {
        console.log('Already running the latest version');
        return true;
      }

      console.log(`Updating from ${currentVersion} to ${latestVersion}...`);
      
      // Pre-update steps
      await this.preUpdateSteps();
      
      // Perform the update
      await this.executeUpdate();
      
      // Post-update steps
      await this.postUpdateSteps();
      
      const newVersion = await this.getCurrentVersion();
      console.log(`✅ Successfully updated to version ${newVersion}`);
      
      return true;
      
    } catch (error) {
      console.error('❌ Update failed:', error.message);
      await this.handleUpdateFailure();
      return false;
    } finally {
      await this.removeLockFile();
    }
  }

  /**
   * Enable automatic updates
   */
  async enableAutoUpdate(policy = 'minor', schedule = '0 3 * * *') {
    try {
      console.log('Enabling automatic updates...');
      
      // Create auto-update configuration
      const config = {
        enabled: true,
        policy: policy,
        schedule: schedule,
        lastCheck: null,
        lastUpdate: null,
        notifications: {
          webhook: process.env.UPDATE_WEBHOOK_URL || null,
          email: process.env.UPDATE_EMAIL || null
        }
      };
      
      await this.saveAutoUpdateConfig(config);
      
      // Install cron job
      await this.installCronJob(schedule);
      
      console.log('✅ Automatic updates enabled');
      console.log(`Policy: ${policy} updates`);
      console.log(`Schedule: ${schedule} (${this.describeCronSchedule(schedule)})`);
      
      return true;
    } catch (error) {
      console.error('❌ Failed to enable automatic updates:', error.message);
      return false;
    }
  }

  /**
   * Disable automatic updates
   */
  async disableAutoUpdate() {
    try {
      console.log('Disabling automatic updates...');
      
      // Remove cron job
      await this.removeCronJob();
      
      // Update configuration
      const config = await this.loadAutoUpdateConfig();
      config.enabled = false;
      await this.saveAutoUpdateConfig(config);
      
      console.log('✅ Automatic updates disabled');
      return true;
    } catch (error) {
      console.error('❌ Failed to disable automatic updates:', error.message);
      return false;
    }
  }

  /**
   * Show auto-update status
   */
  async showAutoUpdateStatus() {
    try {
      const config = await this.loadAutoUpdateConfig();
      
      console.log('Auto-Update Status:');
      console.log('==================');
      console.log(`Enabled: ${config.enabled ? 'Yes' : 'No'}`);
      
      if (config.enabled) {
        console.log(`Policy: ${config.policy}`);
        console.log(`Schedule: ${config.schedule} (${this.describeCronSchedule(config.schedule)})`);
        console.log(`Last Check: ${config.lastCheck || 'Never'}`);
        console.log(`Last Update: ${config.lastUpdate || 'Never'}`);
        
        // Check if cron job exists
        const cronJobExists = await this.checkCronJob();
        console.log(`Cron Job: ${cronJobExists ? 'Active' : 'Not Active'}`);
        
        if (!cronJobExists) {
          console.log('⚠️  Cron job is not active. Run "tcp-serial-relay auto-update --fix" to repair.');
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to get auto-update status:', error.message);
    }
  }

  /**
   * Fix auto-update configuration
   */
  async fixAutoUpdate() {
    try {
      console.log('Fixing auto-update configuration...');
      
      const config = await this.loadAutoUpdateConfig();
      
      if (config.enabled) {
        // Reinstall cron job
        await this.installCronJob(config.schedule);
        console.log('✅ Auto-update configuration fixed');
        console.log('Cron job reinstalled and running');
      } else {
        console.log('Auto-updates are disabled');
      }
      
    } catch (error) {
      console.error('❌ Failed to fix auto-update:', error.message);
    }
  }

  /**
   * Run automatic update check
   */
  async runAutoUpdate() {
    try {
      const config = await this.loadAutoUpdateConfig();
      
      if (!config.enabled) {
        console.log('Automatic updates are disabled');
        return false;
      }
      
      // Update last check time
      config.lastCheck = new Date().toISOString();
      await this.saveAutoUpdateConfig(config);
      
      const currentVersion = await this.getCurrentVersion();
      const latestVersion = await this.getLatestVersion();
      
      if (!this.shouldUpdate(currentVersion, latestVersion, config.policy)) {
        console.log('No update needed');
        return false;
      }
      
      console.log(`Auto-update triggered: ${currentVersion} → ${latestVersion}`);
      
      // Perform update with auto-update context
      const success = await this.performUpdate();
      
      if (success) {
        config.lastUpdate = new Date().toISOString();
        await this.saveAutoUpdateConfig(config);
        
        // Send notification
        await this.sendUpdateNotification('success', currentVersion, latestVersion);
      } else {
        await this.sendUpdateNotification('failed', currentVersion, latestVersion);
      }
      
      return success;
      
    } catch (error) {
      console.error('Auto-update failed:', error.message);
      await this.sendUpdateNotification('error', 'unknown', 'unknown', error.message);
      return false;
    }
  }

  // Helper methods

  async getCurrentVersion() {
    try {
      // Get version from package.json
      const packagePath = path.join(__dirname, '../package.json');
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return packageJson.version;
      }
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  async getLatestVersion() {
    try {
      const { stdout } = await execAsync(`npm view ${this.packageName} version`);
      return stdout.trim();
    } catch (error) {
      throw new Error('Could not fetch latest version from npm registry');
    }
  }

  isUpdateAvailable(current, latest) {
    if (current === 'unknown') return true;
    return this.compareVersions(latest, current) > 0;
  }

  shouldUpdate(current, latest, policy) {
    if (!this.isUpdateAvailable(current, latest)) return false;
    
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    
    switch (policy) {
      case 'patch':
        return currentParts[0] === latestParts[0] && 
               currentParts[1] === latestParts[1] &&
               latestParts[2] > currentParts[2];
      case 'minor':
        return currentParts[0] === latestParts[0] &&
               (latestParts[1] > currentParts[1] || 
                (latestParts[1] === currentParts[1] && latestParts[2] > currentParts[2]));
      case 'major':
        return true;
      default:
        return false;
    }
  }

  compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;
      
      if (v1Part > v2Part) return 1;
      if (v1Part < v2Part) return -1;
    }
    
    return 0;
  }

  async preUpdateSteps() {
    console.log('Running pre-update checks...');
    
    // Backup configuration
    await this.backupConfiguration();
    
    // Check disk space
    await this.checkDiskSpace();
    
    // Stop service if running
    await this.stopService();
  }

  async executeUpdate() {
    console.log('Installing update...');
    
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['update', '-g', this.packageName], {
        stdio: 'inherit'
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm update failed with exit code ${code}`));
        }
      });
      
      child.on('error', reject);
    });
  }

  async postUpdateSteps() {
    console.log('Running post-update checks...');
    
    // Validate installation
    await this.validateInstallation();
    
    // Restart service
    await this.restartService();
    
    // Run health check
    await this.runHealthCheck();
  }

  async backupConfiguration() {
    if (fs.existsSync(this.configPath)) {
      const backupDir = path.dirname(this.configPath) + '/backups';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupDir, `config-backup-${timestamp}.json`);
      
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      fs.copyFileSync(this.configPath, backupFile);
      console.log(`Configuration backed up to: ${backupFile}`);
    }
  }

  async checkDiskSpace() {
    try {
      const { stdout } = await execAsync('df / | tail -1');
      const available = parseInt(stdout.split(/\s+/)[3]);
      
      if (available < 100000) { // Less than ~100MB
        throw new Error('Insufficient disk space for update');
      }
    } catch (error) {
      console.warn('Could not check disk space:', error.message);
    }
  }

  async stopService() {
    try {
      // Try to stop systemd service
      await execAsync('systemctl stop tcp-serial-relay');
      console.log('Service stopped');
    } catch (error) {
      // Service might not be running or not systemd
      console.log('Service was not running or not managed by systemd');
    }
  }

  async restartService() {
    try {
      // Check if systemd service exists
      try {
        await execAsync('systemctl is-enabled tcp-serial-relay');
        await execAsync('systemctl restart tcp-serial-relay');
        console.log('Systemd service restarted');
        return;
      } catch (error) {
        // Not a systemd service
      }
      
      console.log('Service restart not needed for cron-based deployment');
    } catch (error) {
      console.warn('Could not restart service:', error.message);
    }
  }

  async validateInstallation() {
    try {
      // Check if the package is installed
      const packagePath = path.join(__dirname, '../package.json');
      if (!fs.existsSync(packagePath)) {
        throw new Error('Package not found after installation');
      }
      console.log('Installation validated');
    } catch (error) {
      throw new Error('Installation validation failed');
    }
  }

  async runHealthCheck() {
    try {
      // Try to run health check if available
      const healthCheckPath = path.join(__dirname, 'health-check.js');
      if (fs.existsSync(healthCheckPath)) {
        await execAsync(`node ${healthCheckPath} summary`);
        console.log('Health check passed');
      }
    } catch (error) {
      console.warn('Health check failed:', error.message);
    }
  }

  async handleUpdateFailure() {
    console.log('Handling update failure...');
    // Could implement rollback logic here
  }

  async loadAutoUpdateConfig() {
    try {
      if (fs.existsSync(this.updateConfigPath)) {
        const content = fs.readFileSync(this.updateConfigPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('Could not load auto-update config:', error.message);
    }
    
    // Return default config
    return {
      enabled: false,
      policy: 'minor',
      schedule: '0 3 * * *',
      lastCheck: null,
      lastUpdate: null,
      notifications: {}
    };
  }

  async saveAutoUpdateConfig(config) {
    try {
      const configDir = path.dirname(this.updateConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      fs.writeFileSync(this.updateConfigPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Failed to save auto-update config:', error.message);
    }
  }

  async installCronJob(schedule) {
    try {
      // Get current user's crontab
      let currentCrontab = '';
      try {
        const { stdout } = await execAsync('crontab -l');
        currentCrontab = stdout;
      } catch (error) {
        // No existing crontab
      }
      
      // Remove existing tcp-serial-relay auto-update entries
      const lines = currentCrontab.split('\n').filter(line => 
        !line.includes('tcp-serial-relay') || !line.includes('auto-update')
      );
      
      // Add new cron job
      const updateScript = path.join(__dirname, 'update-manager.js');
      const cronEntry = `${schedule} ${updateScript} --auto-run >> /var/log/tcp-serial-relay/auto-update.log 2>&1`;
      lines.push(cronEntry);
      
      // Install new crontab
      const newCrontab = lines.filter(line => line.trim()).join('\n') + '\n';
      
      return new Promise((resolve, reject) => {
        const child = spawn('crontab', ['-'], { stdio: 'pipe' });
        child.stdin.write(newCrontab);
        child.stdin.end();
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log(`Cron job installed with schedule: ${schedule}`);
            resolve();
          } else {
            reject(new Error(`Failed to install cron job (exit code ${code})`));
          }
        });
        
        child.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Failed to install cron job: ${error.message}`);
    }
  }

  async removeCronJob() {
    try {
      // Get current user's crontab
      let currentCrontab = '';
      try {
        const { stdout } = await execAsync('crontab -l');
        currentCrontab = stdout;
      } catch (error) {
        // No existing crontab
        console.log('No existing crontab to modify');
        return;
      }
      
      // Remove tcp-serial-relay auto-update entries
      const lines = currentCrontab.split('\n').filter(line => 
        !line.includes('tcp-serial-relay') || !line.includes('auto-update')
      );
      
      // Install new crontab
      const newCrontab = lines.filter(line => line.trim()).join('\n') + '\n';
      
      return new Promise((resolve, reject) => {
        const child = spawn('crontab', ['-'], { stdio: 'pipe' });
        child.stdin.write(newCrontab);
        child.stdin.end();
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log('Cron job removed');
            resolve();
          } else {
            reject(new Error(`Failed to remove cron job (exit code ${code})`));
          }
        });
        
        child.on('error', reject);
      });
    } catch (error) {
      console.log(`Failed to remove cron job: ${error.message}`);
    }
  }

  async checkCronJob() {
    try {
      const { stdout } = await execAsync('crontab -l');
      return stdout.includes('tcp-serial-relay') && stdout.includes('auto-update');
    } catch (error) {
      return false;
    }
  }

  describeCronSchedule(schedule) {
    const descriptions = {
      '0 3 * * *': 'Daily at 3:00 AM',
      '0 */6 * * *': 'Every 6 hours',
      '0 0 * * 0': 'Weekly on Sunday',
      '0 0 1 * *': 'Monthly on 1st'
    };
    
    return descriptions[schedule] || 'Custom schedule';
  }

  async sendUpdateNotification(status, oldVersion, newVersion, error = null) {
    const config = await this.loadAutoUpdateConfig();
    const deviceId = os.hostname();
    
    const message = {
      device: deviceId,
      status: status,
      oldVersion: oldVersion,
      newVersion: newVersion,
      timestamp: new Date().toISOString(),
      error: error
    };
    
    // Webhook notification
    if (config.notifications.webhook) {
      try {
        spawn('curl', [
          '-X', 'POST',
          config.notifications.webhook,
          '-H', 'Content-Type: application/json',
          '-d', JSON.stringify(message)
        ], { stdio: 'ignore' });
      } catch (error) {
        console.warn('Failed to send webhook notification');
      }
    }
  }

  async isUpdateInProgress() {
    return fs.existsSync(this.lockFile);
  }

  async createLockFile() {
    fs.writeFileSync(this.lockFile, process.pid.toString());
  }

  async removeLockFile() {
    if (fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
    }
  }
}

// Simple CLI argument parsing without external dependencies
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = {};
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++; // Skip next arg as it's the value
      } else {
        options[key] = true;
      }
    }
  }
  
  return { command, options };
}

function showHelp() {
  console.log(`
TCP-Serial Relay Update Manager

Usage: tcp-serial-relay auto-update <command> [options]

Commands:
  check                    Check for available updates
  update                   Update to latest version
  --enable                 Enable automatic updates
  --disable                Disable automatic updates
  status                   Show auto-update status
  --fix                    Fix auto-update configuration
  --auto-run              Run automatic update (used by cron)

Options for --enable:
  --policy <policy>        Update policy (patch|minor|major) [default: minor]
  --schedule <schedule>    Cron schedule [default: "0 3 * * *"]

Examples:
  tcp-serial-relay auto-update check
  tcp-serial-relay auto-update update
  tcp-serial-relay auto-update --enable --policy minor --schedule "0 3 * * *"
  tcp-serial-relay auto-update --disable
  tcp-serial-relay auto-update status
  tcp-serial-relay auto-update --fix
`);
}

// Main execution
async function main() {
  const { command, options } = parseArgs();
  const manager = new UpdateManager();
  
  try {
    switch (command) {
      case 'check':
        await manager.checkForUpdates();
        break;
        
      case 'update':
        await manager.performUpdate();
        break;
        
      case 'status':
        await manager.showAutoUpdateStatus();
        break;
        
      default:
        if (options.enable) {
          const policy = options.policy || 'minor';
          const schedule = options.schedule || '0 3 * * *';
          await manager.enableAutoUpdate(policy, schedule);
        } else if (options.disable) {
          await manager.disableAutoUpdate();
        } else if (options.fix) {
          await manager.fixAutoUpdate();
        } else if (options['auto-run']) {
          await manager.runAutoUpdate();
        } else {
          showHelp();
        }
        break;
    }
  } catch (error) {
    console.error('Command failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = UpdateManager;