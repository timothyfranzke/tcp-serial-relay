// src/app.js - Updated with Dashboard Integration
require('dotenv').config();

const { logger } = require('./utils/logger');
const { loadConfig } = require('./config');
const { shutdown, updateStatus, onShutdown } = require('./utils/status-manager');
const { getDeviceInfo } = require('./utils/device-info');
const RelayService = require('./services/relay-service');
const DashboardServer = require('./services/dashboard-server');

/**
 * Main application class with integrated dashboard
 */
class TcpSerialRelayApp {
  constructor() {
    this.config = null;
    this.relayService = null;
    this.dashboardServer = null;
    this.startTime = new Date();
    this.mode = process.env.MODE || 'normal'; // 'normal', 'dashboard-only', 'relay-only'
  }

  /**
   * Initialize and run the application
   */
  async run() {
    try {
      logger.info('Starting TCP-Serial Relay Application', {
        startTime: this.startTime.toISOString(),
        processId: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        mode: this.mode,
        deviceInfo: getDeviceInfo()
      });

      // Load configuration
      await this.loadConfiguration();

      // Start dashboard server if enabled
      if (this.mode === 'normal' || this.mode === 'dashboard-only') {
        await this.initializeDashboard();
      }

      // Start relay service if enabled
      if (this.mode === 'normal' || this.mode === 'relay-only') {
        await this.initializeRelayService();
        await this.startRelayService();
      }

      // Keep the app running if only dashboard mode
      if (this.mode === 'dashboard-only') {
        logger.info('Running in dashboard-only mode - relay service disabled');
        this.keepAlive();
      }

    } catch (error) {
      logger.error('Application startup failed', { 
        error: error.message,
        stack: error.stack 
      });
      await shutdown(false, `Startup failed: ${error.message}`, 1);
    }
  }

  /**
   * Load and validate configuration
   */
  async loadConfiguration() {
    logger.info('Loading application configuration...');
    updateStatus({ message: 'Loading configuration...' });

    try {
      this.config = await loadConfig();
      logger.info('Configuration loaded successfully', {
        tcpEndpoint: `${this.config.tcpIp}:${this.config.tcpPort}`,
        serialPort: this.config.serialPath,
        serialBaud: this.config.serialBaud
      });
    } catch (error) {
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  /**
   * Initialize the dashboard server
   */
  async initializeDashboard() {
    logger.info('Initializing dashboard server...');
    updateStatus({ message: 'Starting dashboard server...' });

    try {
      const dashboardConfig = {
        port: process.env.DASHBOARD_PORT || 3000,
        host: process.env.DASHBOARD_HOST || '0.0.0.0'
      };

      this.dashboardServer = new DashboardServer(dashboardConfig);
      this.setupDashboardEventHandlers();
      
      await this.dashboardServer.start();
      
      logger.info('Dashboard server started successfully', {
        url: `http://${dashboardConfig.host === '0.0.0.0' ? 'localhost' : dashboardConfig.host}:${dashboardConfig.port}`
      });

      // Setup log forwarding to dashboard
      this.setupLogForwarding();

    } catch (error) {
      throw new Error(`Dashboard server initialization failed: ${error.message}`);
    }
  }

  /**
   * Setup event handlers for dashboard server
   */
  setupDashboardEventHandlers() {
    // Handle service control commands from dashboard
    this.dashboardServer.on('start-service', async () => {
      logger.info('Start service command received from dashboard');
      if (!this.relayService) {
        try {
          await this.initializeRelayService();
          await this.startRelayService();
        } catch (error) {
          logger.error('Failed to start service from dashboard', { error: error.message });
        }
      } else {
        logger.warn('Service already running');
      }
    });

    this.dashboardServer.on('stop-service', async () => {
      logger.info('Stop service command received from dashboard');
      if (this.relayService) {
        try {
          await this.relayService.stop();
          this.relayService = null;
          updateStatus({ message: 'Service stopped via dashboard' });
        } catch (error) {
          logger.error('Failed to stop service from dashboard', { error: error.message });
        }
      }
    });

    this.dashboardServer.on('restart-service', async () => {
      logger.info('Restart service command received from dashboard');
      try {
        if (this.relayService) {
          await this.relayService.stop();
          this.relayService = null;
        }
        
        // Reload configuration
        await this.loadConfiguration();
        await this.initializeRelayService();
        await this.startRelayService();
      } catch (error) {
        logger.error('Failed to restart service from dashboard', { error: error.message });
      }
    });
  }

  /**
   * Setup log forwarding to dashboard
   */
  setupLogForwarding() {
    if (!this.dashboardServer) return;

    // Hook into the logger to forward logs to dashboard
    const originalLog = logger.log;
    logger.log = (level, message, meta) => {
      // Call original log method
      originalLog.call(logger, level, message, meta);
      
      // Forward to dashboard
      this.dashboardServer.addLogEntry(level, message, meta);
    };
  }

  /**
   * Initialize the relay service
   */
  async initializeRelayService() {
    logger.info('Initializing relay service...');
    updateStatus({ message: 'Initializing relay service...' });

    try {
      this.relayService = new RelayService(this.config);
      this.setupRelayEventHandlers();
      logger.info('Relay service initialized successfully');
    } catch (error) {
      throw new Error(`Relay service initialization failed: ${error.message}`);
    }
  }

  /**
   * Setup event handlers for the relay service
   */
  setupRelayEventHandlers() {
    // Relay service started
    this.relayService.on('started', () => {
      logger.info('Relay service started successfully');
      updateStatus({ 
        message: 'Relay service running - waiting for data...',
        success: false // Will be true once data is relayed
      });
    });

    // Data successfully relayed
    this.relayService.on('dataRelayed', (info) => {
      logger.info('Data relayed successfully', info);
      // Update metrics are handled in RelayService
    });

    // Relay error occurred
    this.relayService.on('relayError', (info) => {
      logger.error('Data relay error', info);
    });

    // Client disconnected
    this.relayService.on('clientDisconnected', (info) => {
      logger.warn('Client disconnected', info);
    });

    // Relay completed successfully
    this.relayService.on('completed', async (result) => {
      logger.info('Relay operation completed', result);
      
      // In dashboard mode, don't shutdown automatically
      if (this.mode === 'dashboard-only' || this.dashboardServer) {
        updateStatus({ 
          message: 'Relay operation completed - service ready for next session',
          success: result.success 
        });
        // Stop the relay service but keep app running
        this.relayService = null;
      } else {
        await shutdown(result.success, result.reason, 0);
      }
    });

    // Relay timed out
    this.relayService.on('timeout', async (result) => {
      logger.warn('Relay operation timed out', result);
      
      // In dashboard mode, don't shutdown automatically
      if (this.mode === 'dashboard-only' || this.dashboardServer) {
        updateStatus({ 
          message: 'Relay operation timed out - service ready for next session',
          success: result.success 
        });
        this.relayService = null;
      } else {
        await shutdown(result.success, result.reason, 0);
      }
    });

    // Relay stopped (usually due to disconnection)
    this.relayService.on('stopped', async (result) => {
      logger.info('Relay service stopped', result);
      
      // In dashboard mode, don't shutdown automatically
      if (this.mode === 'dashboard-only' || this.dashboardServer) {
        updateStatus({ 
          message: result.stats ? 'Service stopped after operation' : 'Service stopped unexpectedly',
          success: result.success 
        });
        this.relayService = null;
      } else {
        await shutdown(result.success, result.stats ? 'Service stopped after operation' : 'Service stopped unexpectedly', 0);
      }
    });
  }

  /**
   * Setup shutdown handler for the relay service and dashboard
   */
  setupShutdownHandler() {
    onShutdown(async (finalStatus) => {
      // Stop dashboard server
      if (this.dashboardServer) {
        logger.info('Shutting down dashboard server...');
        try {
          await this.dashboardServer.stop();
          logger.info('Dashboard server shutdown completed');
        } catch (error) {
          logger.error('Error during dashboard server shutdown', { error: error.message });
        }
      }

      // Stop relay service
      if (this.relayService) {
        logger.info('Shutting down relay service...');
        try {
          await this.relayService.stop();
          logger.info('Relay service shutdown completed');
        } catch (error) {
          logger.error('Error during relay service shutdown', { error: error.message });
        }
      }
    });
  }

  /**
   * Start the relay service
   */
  async startRelayService() {
    logger.info('Starting relay service...');
    updateStatus({ message: 'Starting relay service...' });

    try {
      await this.relayService.start();
      logger.info('Application initialization completed successfully');
    } catch (error) {
      throw new Error(`Failed to start relay service: ${error.message}`);
    }
  }

  /**
   * Keep the application alive (for dashboard-only mode)
   */
  keepAlive() {
    // Set up periodic status updates
    setInterval(() => {
      updateStatus({ 
        message: 'Dashboard server running - ready to control relay service',
        success: true 
      });
    }, 30000); // Update every 30 seconds

    logger.info('Application running in dashboard-only mode');
  }

  /**
   * Get application health status
   */
  getHealthStatus() {
    return {
      uptime: Date.now() - this.startTime.getTime(),
      mode: this.mode,
      dashboardServer: this.dashboardServer ? {
        running: true,
        clients: this.dashboardServer.wsClients?.size || 0
      } : null,
      relayService: this.relayService?.getHealthStatus() || null,
      config: this.config ? {
        tcpEndpoint: `${this.config.tcpIp}:${this.config.tcpPort}`,
        serialPort: this.config.serialPath
      } : null
    };
  }
}

/**
 * Main entry point
 */
async function main() {
  const app = new TcpSerialRelayApp();
  await app.run();
}

// Handle unhandled promise rejections and exceptions at the module level
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString()
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Run the application if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal application error:', error);
    process.exit(1);
  });
}

module.exports = { TcpSerialRelayApp, main };