// src/iot-sidecar.js
require('dotenv').config();

const iotDevice = require('aws-iot-device-sdk');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./utils/logger');
const { loadConfig, updateConfig } = require('./config');
const { UpdateManager } = require('./services/update-manager');

/**
 * AWS IoT Core Sidecar Service
 * Handles device shadow updates, secure tunneling, and command execution
 */
class IoTSidecar {
  constructor() {
    this.device = null;
    this.thingName = process.env.IOT_THING_NAME || this.getMacAddress();
    this.clientId = process.env.IOT_CLIENT_ID || `${this.thingName}`;
    this.config = null;
    this.relayProcess = null;
    this.tunnelProcess = null;
    this.updateManager = new UpdateManager({
      appDir: '/opt/tcp-serial-relay',
      currentVersion: require('../package.json').version
    });
    
    // Certificate paths
    this.certPath = process.env.IOT_CERT_PATH || '/opt/tcp-serial-relay/certs/certificate.pem.crt';
    this.keyPath = process.env.IOT_KEY_PATH || '/opt/tcp-serial-relay/certs/private.pem.key';
    this.caPath = process.env.IOT_CA_PATH || '/opt/tcp-serial-relay/certs/AmazonRootCA1.pem';
    this.endpoint = process.env.IOT_ENDPOINT;
    
    // State tracking
    this.shadowState = {
      reported: {
        status: 'initializing',
        version: '1.0.0',
        uptime: 0,
        lastRestart: new Date().toISOString()
      },
      desired: {}
    };
    
    this.startTime = Date.now();
    this.dockerImage = process.env.DOCKER_IMAGE || 'public.ecr.aws/aws-iot-securetunneling-localproxy/ubuntu-bin';
    this.dockerTag = process.env.DOCKER_TAG || (process.arch === 'arm' ? 'armv7-latest' : 'arm64-latest');
    this.destinationPort = process.env.DESTINATION_PORT || '22'; // Default to SSH port; adjust as needed
  }

  /**
   * Get the MAC address of the primary network interface
   */
  getMacAddress() {
    try {
      const networkInterfaces = os.networkInterfaces();
      
      // Priority order: eth0, wlan0, en0, then any other interface
      const priorityInterfaces = ['eth0', 'wlan0', 'en0'];
      
      for (const interfaceName of priorityInterfaces) {
        if (networkInterfaces[interfaceName]) {
          const networkInterface = networkInterfaces[interfaceName].find(net => !net.internal);
          if (networkInterface && networkInterface.mac && networkInterface.mac !== '00:00:00:00:00:00') {
            return networkInterface.mac.replace(/:/g, '').toLowerCase();
          }
        }
      }
      
      // Fallback: find any non-internal interface with a valid MAC
      for (const interfaces of Object.values(networkInterfaces)) {
        const networkInterface = interfaces.find(net => !net.internal && net.mac && net.mac !== '00:00:00:00:00:00');
        if (networkInterface) {
          return networkInterface.mac.replace(/:/g, '').toLowerCase();
        }
      }
      
      // Ultimate fallback
      return 'tcp-relay-unknown';
    } catch (error) {
      logger.warn('Could not determine MAC address', { error: error.message });
      return 'tcp-relay-fallback';
    }
  }

  /**
   * Initialize the IoT sidecar service
   */
  async init() {
    try {
      logger.info('Initializing IoT Sidecar', {
        thingName: this.thingName,
        clientId: this.clientId,
        endpoint: this.endpoint
      });

      // Validate certificate files exist
      await this.validateCertificates();
      
      // Load current config
      await this.loadCurrentConfig();
      
      // Connect to AWS IoT Core
      await this.connectToIoT();
      
      // Setup periodic shadow updates
      this.startPeriodicUpdates();
      
      logger.info('IoT Sidecar initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize IoT Sidecar', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate that certificate files exist and IoT endpoint is configured
   */
  async validateCertificates() {
    // Check if IoT endpoint is configured
    if (!this.endpoint) {
      throw new Error('IOT_ENDPOINT environment variable is not set. Please configure your AWS IoT Core endpoint.');
    }

    const certs = [
      { name: 'Certificate', path: this.certPath },
      { name: 'Private Key', path: this.keyPath },
      { name: 'CA Certificate', path: this.caPath }
    ];

    for (const cert of certs) {
      try {
        await fs.access(cert.path);
        logger.info(`${cert.name} found at ${cert.path}`);
      } catch (error) {
        throw new Error(`${cert.name} not found at ${cert.path}. Please place your AWS IoT certificates in the certs directory.`);
      }
    }

    logger.info('IoT certificates validated successfully', {
      endpoint: this.endpoint,
      thingName: this.thingName,
      certPath: this.certPath,
      keyPath: this.keyPath,
      caPath: this.caPath
    });
  }

  /**
   * Load current application config
   */
  async loadCurrentConfig() {
    try {
      this.config = await loadConfig();
      logger.info('Current config loaded for IoT reporting');
    } catch (error) {
      logger.warn('Could not load config for IoT reporting', { error: error.message });
      this.config = {};
    }
  }

  /**
   * Connect to AWS IoT Core
   */
  async connectToIoT() {
    return new Promise((resolve, reject) => {
      this.device = iotDevice.device({
        keyPath: this.keyPath,
        certPath: this.certPath,
        caPath: this.caPath,
        clientId: this.clientId,
        host: this.endpoint,
        debug: process.env.NODE_ENV === 'development'
      });

      // Connection events
      this.device.on('connect', () => {
        logger.info('Connected to AWS IoT Core');
        this.setupSubscriptions();
        this.updateShadowState({ status: 'connected' });
        resolve();
      });

      this.device.on('close', () => {
        logger.warn('Disconnected from AWS IoT Core');
        this.updateShadowState({ status: 'disconnected' });
      });

      this.device.on('reconnect', () => {
        logger.info('Reconnected to AWS IoT Core');
        this.updateShadowState({ status: 'connected' });
      });

      this.device.on('error', (error) => {
        logger.error('AWS IoT Core connection error', { error: error.message });
        reject(error);
      });

      // Set connection timeout
      setTimeout(() => {
        if (!this.device.isConnected) {
          reject(new Error('IoT connection timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Setup MQTT subscriptions
   */
  setupSubscriptions() {
    // Subscribe to device shadow delta (desired state changes)
    this.device.on('delta', (thingName, stateObject) => {
      logger.info('Received shadow delta', { thingName, stateObject });
      this.handleShadowDelta(stateObject);
    });

    const deltaTopic = `$aws/things/${this.thingName}/shadow/update/delta`;
    this.device.subscribe(deltaTopic);
    
    // Subscribe to tunnel notifications
    const tunnelTopic = `$aws/things/${this.thingName}/tunnels/notify`;
    this.device.subscribe(tunnelTopic);

    // Subscribe to command topic
    const commandTopic = `cmd/${this.thingName}`;
    this.device.subscribe(commandTopic);

    const helloWorldTopic = `hello/world`;
    this.device.subscribe(helloWorldTopic);
    
    // Subscribe to AWS IoT Jobs topics
    const jobNotifyTopic = `$aws/things/${this.thingName}/jobs/notify`;
    const jobNotifyNextTopic = `$aws/things/${this.thingName}/jobs/notify-next`;
    const jobGetAcceptedTopic = `$aws/things/${this.thingName}/jobs/+/get/accepted`;
    const jobUpdateAcceptedTopic = `$aws/things/${this.thingName}/jobs/+/update/accepted`;
    const jobNextGetAcceptedTopic = `$aws/things/${this.thingName}/jobs/$next/get/accepted`;
    
    this.device.subscribe(jobNotifyTopic);
    this.device.subscribe(jobNotifyNextTopic);
    this.device.subscribe(jobGetAcceptedTopic);
    this.device.subscribe(jobUpdateAcceptedTopic);
    this.device.subscribe(jobNextGetAcceptedTopic);
    
    // Single message handler for all MQTT topics
    this.device.on('message', (topic, payload) => {
      logger.info('Received MQTT message', { topic, payload: payload.toString() });
      
      try {
        if (topic === deltaTopic) {
          this.handleShadowDelta(JSON.parse(payload.toString()));
        } else if (topic === helloWorldTopic) {
          logger.info('Received hello/world message', { payload: payload.toString() });
        } else if (topic === tunnelTopic) {
          this.handleTunnelNotification(JSON.parse(payload.toString()));
        } else if (topic === commandTopic) {
          this.handleCommand(JSON.parse(payload.toString()));
        } else if (topic.includes('/jobs/notify')) {
          this.handleJobNotification(JSON.parse(payload.toString()));
        } else if (topic.includes('/jobs/') && topic.includes('/get/accepted')) {
          this.handleJobDetails(JSON.parse(payload.toString()));
        } else if (topic.includes('/jobs/') && topic.includes('/update/accepted')) {
          this.handleJobUpdateResponse(JSON.parse(payload.toString()));
        } else {
          logger.info('Unhandled message topic', { topic, payload: payload.toString() });
        }
      } catch (error) {
        logger.error('Error processing MQTT message', { 
          topic, 
          payload: payload.toString(), 
          error: error.message 
        });
      }
    });

    logger.info('MQTT subscriptions established', {
      tunnelTopic,
      commandTopic,
      shadowTopic: `$aws/things/${this.thingName}/shadow/update/delta`,
      jobNotifyTopic,
      jobNotifyNextTopic,
      jobGetAcceptedTopic,
      jobUpdateAcceptedTopic,
      jobNextGetAcceptedTopic
    });
  }

  /**
   * Handle device shadow delta (desired state changes)
   */
  async handleShadowDelta(stateObject) {
    try {
      const { state } = stateObject;
      
      if (state.config) {
        logger.info('Updating config from shadow', { newConfig: state.config });
        await this.updateConfigFromShadow(state.config);
      }
      
      if (state.command) {
        logger.info('Executing command from shadow', { command: state.command });
        await this.executeCommand(state.command);
      }
      
      // Report back the changes
      this.updateShadowState(state, true);
      
    } catch (error) {
      logger.error('Error handling shadow delta', { error: error.message });
    }
  }

  /**
   * Update config from shadow desired state
   */
  async updateConfigFromShadow(newConfig) {
    try {
      // Merge with existing config
      const updatedConfig = { ...this.config, ...newConfig };
      
      // Update the config file
      await updateConfig(updatedConfig);
      this.config = updatedConfig;
      
      logger.info('Config updated from IoT shadow');
      
      // If relay is running, restart it with new config
      if (this.relayProcess) {
        logger.info('Restarting relay process with updated config');
        await this.stopRelayProcess();
        await this.startRelayProcess();
      }
      
    } catch (error) {
      logger.error('Failed to update config from shadow', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle secure tunnel notifications
   */
  handleTunnelNotification(notification) {
    logger.info('Received tunnel notification', notification);
    
    const { clientAccessToken, region, clientMode } = notification;
    
    if (clientMode === 'destination') {
      this.startTunnel(clientAccessToken, region);
    } else {
      logger.warn('Unexpected tunnel client mode', { clientMode });
    }
  }

  /**
   * Start secure tunnel
   */
  startTunnel(token, region) {
    try {
      // Stop existing tunnel if running
      if (this.tunnelProcess) {
        this.stopTunnelProcess();
      }

      // Use environment variable for token to avoid CLI exposure
      const env = {
        ...process.env,
        AWSIOT_TUNNEL_ACCESS_TOKEN: token
      };

      // Construct Docker command
      const dockerArgs = [
        'run',
        '--rm', // Remove container when it exits
        '--network=host', // Use host networking
        '-e', `AWSIOT_TUNNEL_ACCESS_TOKEN=${token}`, // Pass token via env var
        `${this.dockerImage}:${this.dockerTag}`, // Image and tag
        '-m', 'destination',
        '-r', region,
        '-d', `localhost:${this.destinationPort}`, // Destination service (e.g., SSH on port 22)
        '-c', '/etc/ssl/certs', // SSL cert path to avoid handshake issues
        '-v', '6' // Verbose logging for debugging
      ];

      this.tunnelProcess = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      });

      this.tunnelProcess.stdout.on('data', (data) => {
        logger.info('Tunnel stdout', { output: data.toString() });
      });

      this.tunnelProcess.stderr.on('data', (data) => {
        logger.warn('Tunnel stderr', { output: data.toString() });
      });

      this.tunnelProcess.on('close', (code) => {
        logger.info('Tunnel process closed', { code });
        this.tunnelProcess = null;
        this.updateShadowState({ tunnelStatus: 'inactive' });
      });

      this.tunnelProcess.on('error', (error) => {
        logger.error('Tunnel process error', { error: error.message });
        this.tunnelProcess = null;
        this.updateShadowState({ tunnelStatus: 'error' });
      });

      logger.info('Secure tunnel started via Docker', { region, image: `${this.dockerImage}:${this.dockerTag}` });
      this.updateShadowState({ tunnelStatus: 'active' });

    } catch (error) {
      logger.error('Failed to start tunnel', { error: error.message });
      this.updateShadowState({ tunnelStatus: 'error' });
    }
  }

  stopTunnelProcess() {
    if (!this.tunnelProcess) {
      logger.info('No tunnel process to stop');
      return;
    }

    return new Promise((resolve) => {
      this.tunnelProcess.on('close', () => {
        this.tunnelProcess = null;
        logger.info('Tunnel process stopped');
        this.updateShadowState({ tunnelStatus: 'inactive' });
        resolve();
      });

      this.tunnelProcess.kill('SIGTERM');

      // Force kill after 10 seconds
      setTimeout(() => {
        if (this.tunnelProcess) {
          this.tunnelProcess.kill('SIGKILL');
        }
      }, 10000);
    });
  }

  /**
   * Handle direct commands
   */
  async handleCommand(commandData) {
    const { command, parameters = {} } = commandData;
    
    logger.info('Processing command', { command, parameters });
    
    try {
      switch (command) {
        case 'run':
          await this.startRelayProcess();
          break;
          
        case 'stop':
          await this.stopRelayProcess();
          break;
          
        case 'restart':
          await this.stopRelayProcess();
          await this.startRelayProcess();
          break;
          
        case 'update_config':
          if (parameters.config) {
            await this.updateConfigFromShadow(parameters.config);
          }
          break;
          
        case 'get_status':
          this.reportStatus();
          break;
          
        default:
          logger.warn('Unknown command', { command });
      }
      
    } catch (error) {
      logger.error('Command execution failed', { command, error: error.message });
    }
  }

  /**
   * Execute command (legacy shadow command support)
   */
  async executeCommand(command) {
    await this.handleCommand({ command });
  }

  /**
   * Start the main relay process
   */
  async startRelayProcess() {
    if (this.relayProcess) {
      logger.warn('Relay process already running');
      return;
    }
    
    try {
      const appPath = path.join(__dirname, 'app.js');
      
      this.relayProcess = spawn('node', [appPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CONFIG_PATH: process.env.CONFIG_PATH
        }
      });
      
      this.relayProcess.stdout.on('data', (data) => {
        logger.info('Relay stdout', { output: data.toString() });
      });
      
      this.relayProcess.stderr.on('data', (data) => {
        logger.warn('Relay stderr', { output: data.toString() });
      });
      
      this.relayProcess.on('close', (code) => {
        logger.info('Relay process closed', { code });
        this.relayProcess = null;
        this.updateShadowState({ relayStatus: 'stopped' });
      });
      
      this.relayProcess.on('error', (error) => {
        logger.error('Relay process error', { error: error.message });
        this.relayProcess = null;
        this.updateShadowState({ relayStatus: 'error' });
      });
      
      logger.info('Relay process started');
      this.updateShadowState({ relayStatus: 'running' });
      
    } catch (error) {
      logger.error('Failed to start relay process', { error: error.message });
      throw error;
    }
  }

  /**
   * Stop the relay process
   */
  async stopRelayProcess() {
    if (!this.relayProcess) {
      logger.info('No relay process to stop');
      return;
    }
    
    return new Promise((resolve) => {
      this.relayProcess.on('close', () => {
        this.relayProcess = null;
        logger.info('Relay process stopped');
        this.updateShadowState({ relayStatus: 'stopped' });
        resolve();
      });
      
      this.relayProcess.kill('SIGTERM');
      
      // Force kill after 10 seconds
      setTimeout(() => {
        if (this.relayProcess) {
          this.relayProcess.kill('SIGKILL');
        }
      }, 10000);
    });
  }

  /**
   * Update device shadow state
   */
  updateShadowState(updates, clearDesired = false) {
    this.shadowState.reported = {
      ...this.shadowState.reported,
      ...updates,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime
    };
    
    const shadowUpdate = {
      state: {
        reported: this.shadowState.reported
      }
    };
    
    if (clearDesired) {
      shadowUpdate.state.desired = null;
    }
    
    const shadowTopic = `$aws/things/${this.thingName}/shadow/update`;
    logger.info('Publishing shadow update', { 
      topic: shadowTopic, 
      updates,
      shadowUpdate 
    });
    
    this.device.publish(shadowTopic, JSON.stringify(shadowUpdate));
  }

  /**
   * Report current status
   */
  reportStatus() {
    const updateStatus = this.updateManager.getStatus();
    
    const status = {
      status: 'online',
      relayStatus: this.relayProcess ? 'running' : 'stopped',
      tunnelStatus: this.tunnelProcess ? 'active' : 'inactive',
      config: this.config,
      uptime: Date.now() - this.startTime,
      memory: process.memoryUsage(),
      version: updateStatus.currentVersion,
      updateInProgress: updateStatus.updateInProgress,
      capabilities: {
        softwareUpdates: true,
        secureTunneling: true,
        remoteConfig: true,
        remoteCommands: true
      }
    };
    
    this.updateShadowState(status);
  }

  /**
   * Handle AWS IoT Job notifications
   */
  async handleJobNotification(notification) {
    logger.info('Received job notification', notification);
    
    try {
      // Request the next pending job
      const getJobTopic = `$aws/things/${this.thingName}/jobs/$next/get`;
      this.device.publish(getJobTopic, JSON.stringify({}));
      
      logger.info('Requested next pending job');
    } catch (error) {
      logger.error('Error handling job notification', { error: error.message });
    }
  }

  /**
   * Handle AWS IoT Job details
   */
  async handleJobDetails(jobData) {
    const { execution } = jobData;
    
    if (!execution) {
      logger.info('No pending jobs');
      return;
    }

    const { jobId, jobDocument, versionNumber } = execution;
    
    logger.info('Processing job', { jobId, jobDocument });
    
    // Update job status to IN_PROGRESS
    await this.updateJobStatus(jobId, 'IN_PROGRESS', {
      message: 'Starting job processing',
      timestamp: new Date().toISOString()
    }, versionNumber);

    try {
      let result;
      
      if (jobDocument.operation === 'software_update') {
        result = await this.processSoftwareUpdate(jobDocument);
      } else {
        throw new Error(`Unsupported job operation: ${jobDocument.operation}`);
      }

      // Update job status to SUCCEEDED
      await this.updateJobStatus(jobId, 'SUCCEEDED', {
        message: result.message || 'Job completed successfully',
        result,
        timestamp: new Date().toISOString()
      }, versionNumber);
      
      // Update device shadow with new status
      this.updateShadowState({
        lastJobId: jobId,
        lastJobStatus: 'SUCCEEDED',
        lastJobTimestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Job execution failed', { jobId, error: error.message });
      
      // Update job status to FAILED
      await this.updateJobStatus(jobId, 'FAILED', {
        message: error.message,
        error: error.stack,
        timestamp: new Date().toISOString()
      }, versionNumber);
      
      // Update device shadow with error status
      this.updateShadowState({
        lastJobId: jobId,
        lastJobStatus: 'FAILED',
        lastJobError: error.message,
        lastJobTimestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle job update responses
   */
  handleJobUpdateResponse(response) {
    logger.info('Received job update response', response);
  }

  /**
   * Process software update job
   */
  async processSoftwareUpdate(jobDocument) {
    logger.info('Processing software update job', jobDocument);
    
    try {
      const result = await this.updateManager.processUpdateJob(jobDocument);
      
      logger.info('Software update completed successfully', result);
      
      // Update shadow with new version
      this.updateShadowState({
        version: result.version,
        updateStatus: 'completed',
        lastUpdateTimestamp: new Date().toISOString()
      });
      
      return result;
    } catch (error) {
      logger.error('Software update failed', { error: error.message });
      
      // Update shadow with error status
      this.updateShadowState({
        updateStatus: 'failed',
        updateError: error.message,
        lastUpdateTimestamp: new Date().toISOString()
      });
      
      throw error;
    }
  }

  /**
   * Update AWS IoT Job status
   */
  async updateJobStatus(jobId, status, statusDetails = {}, expectedVersion = 1) {
    const updateTopic = `$aws/things/${this.thingName}/jobs/${jobId}/update`;
    
    const payload = {
      status,
      statusDetails,
      expectedVersion,
      executionNumber: 1,
      includeJobExecutionState: true,
      includeJobDocument: false,
      stepTimeoutInMinutes: 60
    };
    
    try {
      this.device.publish(updateTopic, JSON.stringify(payload));
      logger.info('Updated job status', { jobId, status, statusDetails });
    } catch (error) {
      logger.error('Failed to update job status', { 
        jobId, 
        status, 
        error: error.message 
      });
    }
  }

  /**
   * Check for pending jobs on startup
   */
  async checkForPendingJobs() {
    logger.info('Checking for pending jobs');
    
    try {
      const getJobTopic = `$aws/things/${this.thingName}/jobs/$next/get`;
      this.device.publish(getJobTopic, JSON.stringify({}));
    } catch (error) {
      logger.error('Failed to check for pending jobs', { error: error.message });
    }
  }

  /**
   * Start periodic status updates
   */
  startPeriodicUpdates() {
    // Update shadow every 5 minutes
    setInterval(() => {
      this.reportStatus();
    }, 5 * 60 * 1000);
    
    // Check for pending jobs every 10 minutes
    setInterval(() => {
      this.checkForPendingJobs();
    }, 10 * 60 * 1000);
    
    // Initial status report
    setTimeout(() => {
      this.reportStatus();
    }, 5000);
    
    // Initial job check
    setTimeout(() => {
      this.checkForPendingJobs();
    }, 10000);
  }

  /**
   * Shutdown the sidecar service
   */
  async shutdown() {
    logger.info('Shutting down IoT Sidecar');

    this.updateShadowState({ status: 'shutting_down' });

    if (this.relayProcess) {
      await this.stopRelayProcess();
    }

    if (this.tunnelProcess) {
      await this.stopTunnelProcess();
    }

    if (this.device) {
      this.device.end();
    }

    logger.info('IoT Sidecar shutdown complete');
  }
}

// Main execution
async function main() {
  const sidecar = new IoTSidecar();
  
  // Graceful shutdown handling
  const shutdown = async () => {
    await sidecar.shutdown();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  try {
    await sidecar.init();
    logger.info('IoT Sidecar running');
  } catch (error) {
    logger.error('IoT Sidecar failed to start', { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { IoTSidecar };