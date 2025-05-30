// command-service.js
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execPromise = promisify(exec);

class CommandService {
  constructor(config) {
    this.config = {
      apiEndpoint: process.env.COMMAND_ENDPOINT || 'https://command-2lbtz4kjxa-uc.a.run.app',
      deviceId: process.env.DEVICE_ID || os.hostname(),
      pollIntervalMs: process.env.POLL_INTERVAL ? parseInt(process.env.POLL_INTERVAL) : 60000, // Default: check every minute
      ...config
    };
    this.isRunning = false;
    this.pollTimer = null;
    this.lastCommandId = null;
    console.log(`Command service initialized for device: ${this.config.deviceId}`);
    console.log(`API endpoint: ${this.config.apiEndpoint}`);
    console.log(`Poll interval: ${this.config.pollIntervalMs}ms`);
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`Command service started. Device ID: ${this.config.deviceId}`);
    console.log(`Polling ${this.config.apiEndpoint} every ${this.config.pollIntervalMs}ms`);
    
    // Start polling immediately
    await this.pollForCommands();
    
    // Set up polling interval
    this.pollTimer = setInterval(() => {
      this.pollForCommands().catch(err => {
        console.error('Error polling for commands:', err.message);
      });
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (!this.isRunning) return;
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    this.isRunning = false;
    console.log('Command service stopped');
  }

  async pollForCommands() {
    console.log('Checking for commands...');
    
    try {
      const commandData = await this.fetchCommand();
      
      if (commandData && commandData.hasCommand) {
        console.log(`Received command: ${commandData.command}`);
        const result = await this.executeCommand(commandData);
        console.log('Command execution result:', result);
      } else {
        console.log('No commands to execute');
      }
    } catch (error) {
      console.error('Error in command polling cycle:', error.message);
      // Continue polling despite errors
    }
  }

  async fetchCommand() {
    return new Promise((resolve, reject) => {
      const url = `${this.config.apiEndpoint}?deviceId=${this.config.deviceId}`;
      console.log(`Fetching commands from: ${url}`);
      
      const req = https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              console.log('Response data:', response);
              resolve(response);
            } catch (err) {
              reject(new Error(`Invalid JSON response: ${err.message}`));
            }
          } else if (res.statusCode === 204) {
            // No content means no commands
            resolve(null);
          } else {
            reject(new Error(`API request failed with status: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (err) => {
        reject(new Error(`API request error: ${err.message}`));
      });
      
      req.end();
    });
  }

  async executeCommand(commandData) {
    console.log(`Executing command: ${commandData.command}`);
    
    try {
      // Map the command to a tcp-serial-relay command
      let execCommand = '';
      
      switch (commandData.command) {
        case 'start':
          execCommand = 'tcp-serial-relay start';
          break;
        case 'stop':
          execCommand = 'pkill -f "tcp-serial-relay"';
          break;
        case 'restart':
          execCommand = 'pkill -f "tcp-serial-relay" && tcp-serial-relay start';
          break;
        case 'update':
          execCommand = 'tcp-serial-relay update';
          break;
        default:
          return {
            success: false,
            error: `Unknown command: ${commandData.command}`,
            timestamp: new Date().toISOString()
          };
      }
      
      console.log(`Executing: ${execCommand}`);
      const { stdout, stderr } = await execPromise(execCommand);
      
      return {
        success: true,
        command: commandData.command,
        stdout,
        stderr,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        command: commandData.command,
        error: error.message,
        stderr: error.stderr,
        stdout: error.stdout,
        timestamp: new Date().toISOString()
      };
    }
  }




}

// Main function to run the service
async function main() {
  const service = new CommandService({});

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down command service...');
    service.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down command service...');
    service.stop();
    process.exit(0);
  });
  
  // Start the service
  await service.start();
}

// Run the service
main().catch(error => {
  console.error('Error running command service:', error);
  process.exit(1);
});