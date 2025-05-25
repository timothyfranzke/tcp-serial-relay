#!/usr/bin/env node

// scripts/update-manager.js - Simplified update manager

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

class UpdateManager {
  constructor() {
    this.packageName = 'tcp-serial-relay';
    this.configPath = '/etc/tcp-serial-relay/relay-config.json';
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
        console.log(`New version ${latestVersion} is available`);
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
   * Perform package update if a new version is available
   */
  async performUpdate() {
    if (await this.isUpdateInProgress()) {
      console.log('Update already in progress. Skipping.');
      return false;
    }

    try {
      await this.createLockFile();

      const currentVersion = await this.getCurrentVersion();
      const latestVersion = await this.getLatestVersion();

      if (!this.isUpdateAvailable(currentVersion, latestVersion)) {
        console.log('Already running the latest version. No update needed.');
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
      console.error(`❌ Update failed: ${error.message}`);
      return false;
    } finally {
      await this.removeLockFile();
    }
  }

  /**
   * Update only if new version is available (convenience method)
   */
  async updateIfAvailable() {
    const hasUpdate = await this.checkForUpdates();
    
    if (hasUpdate) {
      console.log('\nProceeding with update...');
      return await this.performUpdate();
    }
    
    return true; // No update needed is considered success
  }

  // Helper methods

  async getCurrentVersion() {
    try {
      // Try to get version from package.json
      const packagePath = path.join(__dirname, '../package.json');
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return packageJson.version;
      }

      // Fallback: try npm list
      try {
        const { stdout } = await execAsync(`npm list -g ${this.packageName} --depth=0`);
        const match = stdout.match(new RegExp(`${this.packageName}@([\\d\\.]+)`));
        if (match) {
          return match[1];
        }
      } catch (npmError) {
        // npm list might fail if package not installed globally
      }

      return 'unknown';
    } catch (error) {
      console.warn(`Could not determine current version: ${error.message}`);
      return 'unknown';
    }
  }

  async getLatestVersion() {
    try {
      const { stdout } = await execAsync(`npm view ${this.packageName} version`);
      return stdout.trim();
    } catch (error) {
      throw new Error(`Could not fetch latest version from npm registry: ${error.message}`);
    }
  }

  isUpdateAvailable(current, latest) {
    if (current === 'unknown') return true;
    return this.compareVersions(latest, current) > 0;
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
      console.warn(`Could not check disk space: ${error.message}`);
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
        console.log('No systemd service found to restart');
      }
    } catch (error) {
      console.warn(`Could not restart service: ${error.message}`);
    }
  }

  async validateInstallation() {
    try {
      // Check if the package is installed
      const newVersion = await this.getCurrentVersion();
      if (newVersion === 'unknown') {
        throw new Error('Package not found after installation');
      }
      console.log('Installation validated');
    } catch (error) {
      throw new Error(`Installation validation failed: ${error.message}`);
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
      console.warn(`Health check failed: ${error.message}`);
    }
  }

  async isUpdateInProgress() {
    return fs.existsSync(this.lockFile);
  }

  async createLockFile() {
    try {
      fs.writeFileSync(this.lockFile, process.pid.toString());
    } catch (error) {
      throw new Error(`Failed to create lock file: ${error.message}`);
    }
  }

  async removeLockFile() {
    if (fs.existsSync(this.lockFile)) {
      try {
        fs.unlinkSync(this.lockFile);
      } catch (error) {
        console.warn(`Failed to remove lock file: ${error.message}`);
      }
    }
  }
}

// Simple CLI
function parseArgs() {
  const args = process.argv.slice(2);
  return args[0] || 'help';
}

function showHelp() {
  console.log(`
TCP-Serial Relay Update Manager

Usage: node update-manager.js <command>

Commands:
  check        Check for available updates
  update       Update to latest version if available
  force        Force update (skip version check)
  help         Show this help

Examples:
  node update-manager.js check
  node update-manager.js update
  node update-manager.js force
`);
}

// Main execution
async function main() {
  const command = parseArgs();
  const manager = new UpdateManager();

  try {
    switch (command) {
      case 'check':
        await manager.checkForUpdates();
        break;

      case 'update':
        await manager.updateIfAvailable();
        break;

      case 'force':
        await manager.performUpdate();
        break;

      case 'help':
      default:
        showHelp();
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