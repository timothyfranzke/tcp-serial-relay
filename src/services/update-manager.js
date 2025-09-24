// src/services/update-manager.js

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const { logger } = require('../utils/logger');

/**
 * UpdateManager handles software updates for the TCP-Serial Relay
 * Supports AWS IoT Jobs-based updates with rollback capability
 */
class UpdateManager {
  constructor(options = {}) {
    this.appDir = options.appDir || '/opt/tcp-serial-relay';
    this.backupDir = options.backupDir || '/opt/tcp-serial-relay-backup';
    this.downloadDir = options.downloadDir || '/tmp/relay-updates';
    this.currentVersion = options.currentVersion || '1.0.0';
    this.updateInProgress = false;
  }

  /**
   * Process a software update job
   */
  async processUpdateJob(jobDocument) {
    if (this.updateInProgress) {
      throw new Error('Update already in progress');
    }

    const { operation, version, downloadUrl, checksum, restartRequired = true } = jobDocument;

    if (operation !== 'software_update') {
      throw new Error(`Unsupported operation: ${operation}`);
    }

    if (!version || !downloadUrl || !checksum) {
      throw new Error('Missing required update parameters: version, downloadUrl, or checksum');
    }

    logger.info('Starting software update process', { 
      currentVersion: this.currentVersion, 
      targetVersion: version 
    });

    this.updateInProgress = true;

    try {
      // 1. Create backup of current version
      await this.createBackup();

      // 2. Download update package
      const downloadPath = await this.downloadUpdate(downloadUrl, checksum);

      // 3. Verify update package
      await this.verifyUpdate(downloadPath, checksum);

      // 4. Apply update
      await this.applyUpdate(downloadPath, version);

      // 5. Verify installation
      await this.verifyInstallation(version);

      // 6. Restart services if required
      if (restartRequired) {
        await this.restartServices();
      }

      this.currentVersion = version;
      logger.info('Software update completed successfully', { version });

      return {
        success: true,
        version,
        message: 'Update completed successfully'
      };

    } catch (error) {
      logger.error('Software update failed, attempting rollback', { error: error.message });
      
      try {
        await this.rollbackUpdate();
      } catch (rollbackError) {
        logger.error('Rollback failed', { error: rollbackError.message });
      }

      throw error;
    } finally {
      this.updateInProgress = false;
      await this.cleanup();
    }
  }

  /**
   * Create backup of current installation
   */
  async createBackup() {
    logger.info('Creating backup of current installation');

    try {
      // Remove old backup if exists
      await fs.rmdir(this.backupDir, { recursive: true }).catch(() => {});

      // Create backup directory
      await fs.mkdir(this.backupDir, { recursive: true });

      // Copy current installation to backup
      await this.executeCommand('cp', ['-r', `${this.appDir}/.`, this.backupDir]);

      logger.info('Backup created successfully', { backupDir: this.backupDir });
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Download update package
   */
  async downloadUpdate(downloadUrl, expectedChecksum) {
    logger.info('Downloading update package', { downloadUrl });

    await fs.mkdir(this.downloadDir, { recursive: true });
    const filename = path.basename(new URL(downloadUrl).pathname) || 'update.tar.gz';
    const downloadPath = path.join(this.downloadDir, filename);

    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(downloadPath);
      const hash = crypto.createHash('sha256');

      https.get(downloadUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status: ${response.statusCode}`));
          return;
        }

        response.on('data', (chunk) => {
          hash.update(chunk);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          const actualChecksum = hash.digest('hex');
          
          if (actualChecksum === expectedChecksum.replace('sha256:', '')) {
            logger.info('Update package downloaded and verified', { downloadPath });
            resolve(downloadPath);
          } else {
            reject(new Error(`Checksum mismatch. Expected: ${expectedChecksum}, Got: sha256:${actualChecksum}`));
          }
        });

        file.on('error', (error) => {
          reject(new Error(`Download failed: ${error.message}`));
        });
      }).on('error', (error) => {
        reject(new Error(`Download request failed: ${error.message}`));
      });
    });
  }

  /**
   * Verify update package integrity
   */
  async verifyUpdate(filePath, expectedChecksum) {
    logger.info('Verifying update package integrity');

    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const actualChecksum = hash.digest('hex');

      const expected = expectedChecksum.replace('sha256:', '');
      if (actualChecksum !== expected) {
        throw new Error(`Package verification failed. Expected: ${expected}, Got: ${actualChecksum}`);
      }

      logger.info('Update package verification successful');
    } catch (error) {
      throw new Error(`Package verification failed: ${error.message}`);
    }
  }

  /**
   * Apply the update
   */
  async applyUpdate(packagePath, version) {
    logger.info('Applying update', { packagePath, version });

    try {
      // Create temporary extraction directory
      const extractDir = path.join(this.downloadDir, 'extracted');
      await fs.mkdir(extractDir, { recursive: true });

      // Extract update package
      await this.executeCommand('tar', ['-xzf', packagePath, '-C', extractDir]);

      // Stop services before updating
      await this.stopServices();

      // Copy new files to application directory
      await this.executeCommand('cp', ['-r', `${extractDir}/.`, this.appDir]);

      // Install dependencies
      await this.executeCommand('npm', ['install', '--production'], { cwd: this.appDir });

      // Update file permissions
      await this.executeCommand('chown', ['-R', 'relay:relay', this.appDir]);
      await this.executeCommand('chmod', ['+x', path.join(this.appDir, 'src/app.js')]);

      logger.info('Update applied successfully');
    } catch (error) {
      throw new Error(`Failed to apply update: ${error.message}`);
    }
  }

  /**
   * Verify installation after update
   */
  async verifyInstallation(expectedVersion) {
    logger.info('Verifying installation', { expectedVersion });

    try {
      // Check package.json version
      const packageJsonPath = path.join(this.appDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

      if (packageJson.version !== expectedVersion) {
        throw new Error(`Version mismatch. Expected: ${expectedVersion}, Found: ${packageJson.version}`);
      }

      // Check if main files exist
      const mainScript = path.join(this.appDir, 'src/app.js');
      await fs.access(mainScript);

      logger.info('Installation verification successful', { version: expectedVersion });
    } catch (error) {
      throw new Error(`Installation verification failed: ${error.message}`);
    }
  }

  /**
   * Rollback to previous version
   */
  async rollbackUpdate() {
    logger.info('Rolling back to previous version');

    try {
      if (!await this.backupExists()) {
        throw new Error('No backup available for rollback');
      }

      // Stop services
      await this.stopServices();

      // Remove current (failed) installation
      await this.executeCommand('rm', ['-rf', `${this.appDir}/*`]);

      // Restore from backup
      await this.executeCommand('cp', ['-r', `${this.backupDir}/.`, this.appDir]);

      // Restart services
      await this.restartServices();

      logger.info('Rollback completed successfully');
    } catch (error) {
      throw new Error(`Rollback failed: ${error.message}`);
    }
  }

  /**
   * Stop application services
   */
  async stopServices() {
    logger.info('Stopping application services');

    try {
      await this.executeCommand('systemctl', ['stop', 'tcp-serial-relay']);
      // Wait a moment for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      logger.warn('Failed to stop services via systemctl', { error: error.message });
    }
  }

  /**
   * Restart application services
   */
  async restartServices() {
    logger.info('Restarting application services');

    try {
      await this.executeCommand('systemctl', ['start', 'tcp-serial-relay']);
      // Wait for services to start
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      throw new Error(`Failed to restart services: ${error.message}`);
    }
  }

  /**
   * Check if backup exists
   */
  async backupExists() {
    try {
      await fs.access(this.backupDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup temporary files
   */
  async cleanup() {
    logger.info('Cleaning up temporary files');

    try {
      await fs.rmdir(this.downloadDir, { recursive: true }).catch(() => {});
    } catch (error) {
      logger.warn('Failed to cleanup temporary files', { error: error.message });
    }
  }

  /**
   * Execute shell command
   */
  async executeCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Command execution failed: ${error.message}`));
      });
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      currentVersion: this.currentVersion,
      updateInProgress: this.updateInProgress,
      backupAvailable: this.backupExists()
    };
  }
}

module.exports = { UpdateManager };