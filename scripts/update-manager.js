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
        const cronExists = await this.checkCronJob();
        console.log(`Cron Job: ${cronExists ? 'Installed' : 'Missing'}`);
        
        if (!cronExists) {
          console.log('⚠️  Cron job is missing. Run "tcp-serial-relay auto-update --fix" to repair.');
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
      const { stdout } = await execAsync('tcp-serial-relay --version');
      return stdout.trim();
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
    const { stdout } = await execAsync('df / | tail -1');
    const available = parseInt(stdout.split(/\s+/)[3]);
    
    if (available < 100000) { // Less than ~100MB
      throw new Error('Insufficient disk space for update');
    }
  }

  async stopService() {
    try {
      await execAsync('tcp-serial-relay stop');
      console.log('Service stopped');
    } catch (error) {
      // Service might not be running
      console.log('Service was not running');
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
      
      // Check if it should run as daemon
      const config = await this.loadAutoUpdateConfig();
      if (config.startAfterUpdate !== false) {
        await execAsync('tcp-serial-relay start --daemon');
        console.log('Service started as daemon');
      }
    } catch (error) {
      console.warn('Could not restart service:', error.message);
    }
  }

  async validateInstallation() {
    try {
      await execAsync('tcp-serial-relay --version');
      await execAsync('tcp-serial-relay config --validate');
      console.log('Installation validated');
    } catch (error) {
      throw new Error('Installation validation failed');
    }
  }

  async runHealthCheck() {
    try {
      await execAsync('tcp-serial-relay health');
      console.log('Health check passed');
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
    const configDir = path.dirname(this.updateConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(this.updateConfigPath, JSON.stringify(config, null, 2));
  }

  async installCronJob(schedule) {
    const cronCommand = `${process.argv[0]} ${__filename} --auto-run`;
    const cronEntry = `${schedule} ${cronCommand}`;
    
    try {
      // Get existing crontab
      let existingCron = '';
      try {
        const { stdout } = await execAsync('crontab -l');
        existingCron = stdout;
      } catch (error) {
        // No existing crontab
      }
      
      // Remove existing tcp-serial-relay entries
      const lines = existingCron.split('\n')
        .filter(line => !line.includes('tcp-serial-relay') && line.trim() !== '');
      
      // Add new entry
      lines.push(cronEntry);
      
      // Install new crontab
      const newCron = lines.join('\n') + '\n';
      await execAsync(`echo "${newCron}" | crontab -`);
      
      console.log(`Cron job installed: ${cronEntry}`);
    } catch (error) {
      throw new Error(`Failed to install cron job: ${error.message}`);
    }
  }

  async removeCronJob() {
    try {
      const { stdout } = await execAsync('crontab -l');
      const lines = stdout.split('\n')
        .filter(line => !line.includes('tcp-serial-relay') && line.trim() !== '');
      
      const newCron = lines.join('\n') + (lines.length > 0 ? '\n' : '');
      await execAsync(`echo "${newCron}" | crontab -`);
      
      console.log('Cron job removed');
    } catch (error) {
      // Might not have existing crontab
      console.log('No cron job to remove');
    }
  }

  async checkCronJob() {
    try {
      const { stdout } = await execAsync('crontab -l');
      return stdout.includes('tcp-serial-relay');
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
        const { spawn } = require('child_process');
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
    
    // Email notification (if configured)
    if (config.notifications.email) {
      // Could implement email notifications here
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

// CLI interface
const { program } = require('commander');

program
  .name('update-manager')
  .description('TCP-Serial Relay update management')
  .version('1.0.0');

program
  .command('check')
  .description('Check for available updates')
  .action(async () => {
    const manager = new UpdateManager();
    await manager.checkForUpdates();
  });

program
  .command('update')
  .description('Update to latest version')
  .action(async () => {
    const manager = new UpdateManager();
    await manager.performUpdate();
  });

program
  .command('enable-auto')
  .description('Enable automatic updates')
  .option('--policy <policy>', 'Update policy (patch|minor|major)', 'minor')
  .option('--schedule <schedule>', 'Cron schedule', '0 3 * * *')
  .action(async (options) => {
    const manager = new UpdateManager();
    await manager.enableAutoUpdate(options.policy, options.schedule);
  });

program
  .command('disable-auto')
  .description('Disable automatic updates')
  .action(async () => {
    const manager = new UpdateManager();
    await manager.disableAutoUpdate();
  });

program
  .command('status')
  .description('Show auto-update status')
  .action(async () => {
    const manager = new UpdateManager();
    await manager.showAutoUpdateStatus();
  });

program
  .command('fix')
  .description('Fix auto-update configuration')
  .action(async () => {
    const manager = new UpdateManager();
    await manager.fixAutoUpdate();
  });

program
  .option('--auto-run', 'Run automatic update (used by cron)')
  .action(async (options) => {
    if (options.autoRun) {
      const manager = new UpdateManager();
      await manager.runAutoUpdate();
    } else {
      program.help();
    }
  });

// Run if called directly
if (require.main === module) {
  program.parse(process.argv);
  
  if (process.argv.length <= 2) {
    program.help();
  }
}

module.exports = UpdateManager;