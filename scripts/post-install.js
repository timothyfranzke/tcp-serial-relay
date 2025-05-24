#!/usr/bin/env node

// scripts/postinstall.js - Run after npm install

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class PostInstallSetup {
  constructor() {
    this.isRaspberryPi = this.detectRaspberryPi();
    this.isGlobalInstall = this.detectGlobalInstall();
    this.packageRoot = this.findPackageRoot();
    
    console.log('TCP-Serial Relay Post-Install Setup');
    console.log('===================================');
    console.log(`Platform: ${os.platform()} ${os.arch()}`);
    console.log(`Raspberry Pi: ${this.isRaspberryPi ? 'Yes' : 'No'}`);
    console.log(`Global Install: ${this.isGlobalInstall ? 'Yes' : 'No'}`);
    console.log(`Package Root: ${this.packageRoot}`);
    console.log('');
  }

  detectRaspberryPi() {
    try {
      return fs.existsSync('/proc/device-tree/model') && 
             fs.readFileSync('/proc/device-tree/model', 'utf8').includes('Raspberry Pi');
    } catch (error) {
      return false;
    }
  }

  detectGlobalInstall() {
    // Check if we're in a global npm installation
    const globalNodeModules = path.join(process.execPath, '..', '..', 'lib', 'node_modules');
    return __dirname.startsWith(globalNodeModules) || 
           process.env.npm_config_global === 'true';
  }

  findPackageRoot() {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
          if (pkg.name === '@yourcompany/tcp-serial-relay') {
            return dir;
          }
        } catch (error) {
          // Continue searching
        }
      }
      dir = path.dirname(dir);
    }
    return __dirname;
  }

  async createDirectories() {
    console.log('Creating directories...');
    
    const directories = [
      '/var/log/tcp-serial-relay',
      '/etc/tcp-serial-relay',
      '/opt/tcp-serial-relay/status'
    ];

    for (const dir of directories) {
      try {
        if (!fs.existsSync(dir)) {
          await execAsync(`sudo mkdir -p ${dir}`);
          console.log(`  ✓ Created ${dir}`);
        } else {
          console.log(`  - ${dir} already exists`);
        }
      } catch (error) {
        console.warn(`  ⚠ Could not create ${dir}: ${error.message}`);
      }
    }
  }

  async createUser() {
    if (!this.isRaspberryPi) {
      console.log('Skipping user creation (not Raspberry Pi)');
      return;
    }

    console.log('Creating service user...');
    
    try {
      // Check if user exists
      await execAsync('id relay');
      console.log('  - User "relay" already exists');
    } catch (error) {
      try {
        await execAsync('sudo useradd -r -s /bin/false -d /opt/tcp-serial-relay relay');
        await execAsync('sudo usermod -a -G dialout relay');
        console.log('  ✓ Created user "relay" and added to dialout group');
      } catch (createError) {
        console.warn(`  ⚠ Could not create user: ${createError.message}`);
      }
    }
  }

  async setPermissions() {
    if (!this.isRaspberryPi) {
      console.log('Skipping permission setup (not Raspberry Pi)');
      return;
    }

    console.log('Setting permissions...');
    
    const commands = [
      'sudo chown -R relay:relay /var/log/tcp-serial-relay',
      'sudo chown -R root:relay /etc/tcp-serial-relay',
      'sudo chmod 755 /etc/tcp-serial-relay',
      'sudo chown -R relay:relay /opt/tcp-serial-relay'
    ];

    for (const cmd of commands) {
      try {
        await execAsync(cmd);
        console.log(`  ✓ ${cmd}`);
      } catch (error) {
        console.warn(`  ⚠ Failed: ${cmd} - ${error.message}`);
      }
    }
  }

  async createDefaultConfig() {
    const configPath = '/etc/tcp-serial-relay/relay-config.json';
    
    if (fs.existsSync(configPath)) {
      console.log('Configuration file already exists');
      return;
    }

    console.log('Creating default configuration...');
    
    const defaultConfig = {
      tcpIp: '192.168.1.90',
      tcpPort: 10002,
      serialPath: '/dev/ttyUSB0',
      serialBaud: 9600,
      serialParity: 'odd',
      serialDataBits: 7,
      serialStopBits: 1,
      maxRetries: 3,
      retryDelay: 5000,
      connectionTimeout: 10000,
      relayTimeout: 30000,
      logDataTransfers: true,
      logLevel: 'info'
    };

    try {
      const tempFile = path.join(os.tmpdir(), 'relay-config.json');
      fs.writeFileSync(tempFile, JSON.stringify(defaultConfig, null, 2));
      
      await execAsync(`sudo mv ${tempFile} ${configPath}`);
      await execAsync(`sudo chown root:relay ${configPath}`);
      await execAsync(`sudo chmod 640 ${configPath}`);
      
      console.log(`  ✓ Created ${configPath}`);
    } catch (error) {
      console.warn(`  ⚠ Could not create config file: ${error.message}`);
    }
  }

  async setupLogRotate() {
    if (!this.isRaspberryPi) {
      console.log('Skipping logrotate setup (not Raspberry Pi)');
      return;
    }

    console.log('Setting up log rotation...');
    
    const logrotateConfig = `
/var/log/tcp-serial-relay/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 relay relay
    postrotate
        /bin/true
    endscript
}

/opt/tcp-serial-relay/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 relay relay
}
`;

    try {
      const tempFile = path.join(os.tmpdir(), 'tcp-serial-relay-logrotate');
      fs.writeFileSync(tempFile, logrotateConfig);
      
      await execAsync(`sudo mv ${tempFile} /etc/logrotate.d/tcp-serial-relay`);
      await execAsync('sudo chmod 644 /etc/logrotate.d/tcp-serial-relay');
      
      console.log('  ✓ Log rotation configured');
    } catch (error) {
      console.warn(`  ⚠ Could not setup logrotate: ${error.message}`);
    }
  }

  async createSymlink() {
    if (!this.isGlobalInstall) {
      console.log('Skipping symlink creation (not global install)');
      return;
    }

    console.log('Creating package symlink...');
    
    try {
      const symlinkPath = '/opt/tcp-serial-relay/package';
      
      if (fs.existsSync(symlinkPath) || fs.lstatSync(symlinkPath).isSymbolicLink()) {
        await execAsync(`sudo rm -f ${symlinkPath}`);
      }
      
      await execAsync(`sudo ln -sf ${this.packageRoot} ${symlinkPath}`);
      console.log(`  ✓ Created symlink: ${symlinkPath} -> ${this.packageRoot}`);
    } catch (error) {
      console.warn(`  ⚠ Could not create symlink: ${error.message}`);
    }
  }

  async checkDependencies() {
    console.log('Checking system dependencies...');
    
    const dependencies = [
      { cmd: 'node --version', name: 'Node.js' },
      { cmd: 'npm --version', name: 'npm' }
    ];

    for (const dep of dependencies) {
      try {
        const { stdout } = await execAsync(dep.cmd);
        console.log(`  ✓ ${dep.name}: ${stdout.trim()}`);
      } catch (error) {
        console.warn(`  ⚠ ${dep.name}: Not found or error`);
      }
    }
  }

  showNextSteps() {
    console.log('');
    console.log('Installation completed!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Configure the service:');
    console.log('     tcp-serial-relay config --edit');
    console.log('');
    console.log('  2. Test the configuration:');
    console.log('     tcp-serial-relay config --validate');
    console.log('');
    console.log('  3. List available serial ports:');
    console.log('     tcp-serial-relay list-ports');
    console.log('');
    console.log('  4. Run health check:');
    console.log('     tcp-serial-relay health');
    console.log('');
    console.log('  5. Start the service:');
    console.log('     tcp-serial-relay start');
    console.log('');
    
    if (this.isRaspberryPi) {
      console.log('  6. Install as system service (optional):');
      console.log('     tcp-serial-relay install-service --cron');
      console.log('');
    }
    
    console.log('For help: tcp-serial-relay --help');
    console.log('');
  }

  async run() {
    try {
      await this.checkDependencies();
      
      if (this.isRaspberryPi && process.getuid && process.getuid() !== 0) {
        console.log('Note: Some setup steps require sudo privileges');
        console.log('');
      }
      
      // Only do system setup if we have appropriate permissions
      if (this.isRaspberryPi) {
        try {
          await this.createDirectories();
          await this.createUser();
          await this.setPermissions();
          await this.createDefaultConfig();
          await this.setupLogRotate();
          await this.createSymlink();
        } catch (error) {
          console.warn('Some system setup steps failed - you may need to run as sudo');
        }
      }
      
      this.showNextSteps();
      
    } catch (error) {
      console.error('Post-install setup failed:', error.message);
      console.error('You can run setup manually with: tcp-serial-relay setup');
    }
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  const setup = new PostInstallSetup();
  setup.run();
}

module.exports = PostInstallSetup;