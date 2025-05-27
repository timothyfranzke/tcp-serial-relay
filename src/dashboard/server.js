// src/dashboard/server.js - Fixed Dashboard Server
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

class DashboardServer {
  constructor(options = {}) {
    this.port = options.port || process.env.DASHBOARD_PORT || process.env.PORT || 3000;
    this.host = options.host || process.env.HOST || '0.0.0.0';
    this.app = express();
    this.publicDir = path.join(__dirname, 'public');
    this.configPath = this.findConfigPath();
    this.statusDir = this.findStatusDir();
    this.logDir = this.findLogDir();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.ensurePublicDir();
  }

  findConfigPath() {
    const configPaths = [
      process.env.CONFIG_PATH,
      '/etc/tcp-serial-relay/relay-config.json',
      path.join(process.cwd(), 'config', 'relay-config.json'),
      path.join(__dirname, '..', '..', 'config', 'relay-config.json')
    ].filter(Boolean);
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    
    // Default path if none exist
    return path.join(process.cwd(), 'config', 'relay-config.json');
  }

  findStatusDir() {
    const statusDirs = [
      process.env.STATUS_DIR,
      '/opt/tcp-serial-relay/status',
      path.join(process.cwd(), 'status'),
      path.join(__dirname, '..', '..', 'status')
    ].filter(Boolean);
    
    for (const statusDir of statusDirs) {
      if (fs.existsSync(statusDir)) {
        return statusDir;
      }
    }
    
    return null;
  }

  findLogDir() {
    const logDirs = [
      '/var/log/tcp-serial-relay',
      path.join(process.cwd(), 'logs'),
      path.join(__dirname, '..', '..', 'logs')
    ];
    
    for (const logDir of logDirs) {
      if (fs.existsSync(logDir)) {
        return logDir;
      }
    }
    
    return null;
  }

  ensurePublicDir() {
    if (!fs.existsSync(this.publicDir)) {
      fs.mkdirSync(this.publicDir, { recursive: true });
      console.log(`📁 Created public directory: ${this.publicDir}`);
    }
  }

  setupMiddleware() {
    // Enable CORS for API access
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    this.app.use(express.json());
    
    // Serve static files from public directory
    this.app.use(express.static(this.publicDir));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // API Routes - Fixed parameter patterns
    this.app.get('/api/status', this.getStatus.bind(this));
    this.app.get('/api/config', this.getConfig.bind(this));
    this.app.post('/api/config', this.updateConfig.bind(this));
    this.app.get('/api/logs', this.getLogs.bind(this));
    this.app.get('/api/health', this.getHealth.bind(this));
    this.app.get('/api/ports', this.getPorts.bind(this));
    
    // Control routes - using specific paths instead of parameters
    this.app.post('/api/control/start', (req, res) => this.controlService(req, res, 'start'));
    this.app.post('/api/control/stop', (req, res) => this.controlService(req, res, 'stop'));
    this.app.post('/api/control/restart', (req, res) => this.controlService(req, res, 'restart'));
    
    // WebSocket endpoint placeholder (for future real-time features)
    this.app.get('/ws', (req, res) => {
      res.status(501).json({ error: 'WebSocket not implemented yet' });
    });
    
    // Serve main dashboard for all other routes
    this.app.get('*', (req, res) => {
      const indexPath = path.join(this.publicDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send(`
          <h1>Dashboard Files Missing</h1>
          <p>Dashboard static files not found at: <code>${indexPath}</code></p>
          <p>Expected files:</p>
          <ul>
            <li>${this.publicDir}/index.html</li>
            <li>${this.publicDir}/main.css</li>
            <li>${this.publicDir}/main.js</li>
          </ul>
        `);
      }
    });
  }

  async getStatus(req, res) {
    try {
      let latestStatus = null;
      
      // Try to read latest status file
      if (this.statusDir && fs.existsSync(this.statusDir)) {
        const statusFiles = fs.readdirSync(this.statusDir)
          .filter(f => f.startsWith('status-') && f.endsWith('.json'))
          .sort()
          .reverse();

        if (statusFiles.length > 0) {
          const statusFile = path.join(this.statusDir, statusFiles[0]);
          try {
            latestStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
          } catch (error) {
            console.warn('Error reading status file:', error.message);
          }
        }
      }

      const status = {
        timestamp: new Date().toISOString(),
        overall: latestStatus?.success ? 'HEALTHY' : 'UNKNOWN',
        success: latestStatus?.success || false,
        message: latestStatus?.message || 'No recent status available',
        duration: latestStatus?.duration || 0,
        connections: latestStatus?.connections || {
          tcp: { connected: false },
          secondary: { connected: false }
        },
        metrics: latestStatus?.metrics || {
          dataTransfers: 0,
          errors: 0,
          bytesTransferredTcpToSerial: 0,
          bytesTransferredSerialToTcp: 0,
          bytesTransferredTcpToSecondaryTcp: 0,
          bytesTransferredSecondaryTcpToTcp: 0
        },
        systemMetrics: {
          uptime: os.uptime(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpuUsage: 0,
          loadAvg: os.loadavg()
        }
      };

      res.json({ status });
    } catch (error) {
      console.error('Error in getStatus:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getConfig(req, res) {
    try {
      let config = {};
      
      if (fs.existsSync(this.configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        } catch (error) {
          console.warn('Error reading config file:', error.message);
        }
      }

      res.json({ config });
    } catch (error) {
      console.error('Error in getConfig:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async updateConfig(req, res) {
    try {
      const newConfig = req.body;
      
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      fs.writeFileSync(this.configPath, JSON.stringify(newConfig, null, 2));
      console.log(`📝 Configuration updated: ${this.configPath}`);
      res.json({ success: true, message: 'Configuration updated successfully' });
    } catch (error) {
      console.error('Error in updateConfig:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getLogs(req, res) {
    try {
      const lines = parseInt(req.query.lines) || 50;
      const logs = [];
      
      if (this.logDir && fs.existsSync(this.logDir)) {
        const logFiles = fs.readdirSync(this.logDir)
          .filter(f => f.endsWith('.log') && !f.includes('data-transfer'))
          .sort()
          .reverse();
        
        if (logFiles.length > 0) {
          const logFile = path.join(this.logDir, logFiles[0]);
          try {
            const content = fs.readFileSync(logFile, 'utf8');
            const logLines = content.split('\n')
              .filter(line => line.trim())
              .slice(-lines)
              .map((line) => {
                // Parse log format: 2023-12-07 10:30:15.123 [INFO]: Message
                const match = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\s+\[(\w+)\]:\s+(.+)$/);
                if (match) {
                  return {
                    timestamp: match[1],
                    level: match[2].toLowerCase(),
                    message: match[3]
                  };
                }
                return {
                  timestamp: new Date().toISOString(),
                  level: 'info',
                  message: line
                };
              });
            logs.push(...logLines);
          } catch (error) {
            console.warn('Error reading log file:', error.message);
          }
        }
      }

      if (logs.length === 0) {
        // Generate sample logs if no real logs found
        logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'No log files found. Start the relay service to generate logs.'
        });
      }
      
      res.json({ logs: logs.reverse() });
    } catch (error) {
      console.error('Error in getLogs:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getHealth(req, res) {
    try {
      const health = {
        status: 'healthy',
        uptime: process.uptime() * 1000,
        dashboardServer: {
          running: true,
          port: this.port,
          publicDir: this.publicDir,
          configPath: this.configPath,
          statusDir: this.statusDir,
          logDir: this.logDir
        },
        connections: {
          tcp: { connected: false },
          secondary: { connected: false }
        },
        metrics: {
          dataTransfers: 0,
          errors: 0
        }
      };

      res.json(health);
    } catch (error) {
      console.error('Error in getHealth:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getPorts(req, res) {
    try {
      // Try to load SerialPort dynamically
      let ports = [];
      try {
        const { SerialPort } = require('serialport');
        ports = await SerialPort.list();
      } catch (error) {
        console.warn('SerialPort not available:', error.message);
      }
      
      res.json({ ports });
    } catch (error) {
      console.error('Error in getPorts:', error);
      res.json({ ports: [], error: 'Could not list serial ports' });
    }
  }

  async controlService(req, res, action) {
    try {
      // In a real implementation, this would control the actual relay service
      // For now, just acknowledge the command
      switch (action) {
        case 'start':
          res.json({ success: true, message: 'Start command received (dashboard-only mode)' });
          break;
        case 'stop':
          res.json({ success: true, message: 'Stop command received (dashboard-only mode)' });
          break;
        case 'restart':
          res.json({ success: true, message: 'Restart command received (dashboard-only mode)' });
          break;
        default:
          res.status(400).json({ error: 'Unknown action: ' + action });
      }
    } catch (error) {
      console.error('Error in controlService:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, this.host, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`✅ TCP-Serial Relay Dashboard started successfully`);
          console.log(`🌐 Dashboard URL: http://localhost:${this.port}`);
          console.log(`📁 Static files: ${this.publicDir}`);
          console.log(`⚙️  Config file: ${this.configPath}`);
          if (this.statusDir) console.log(`📊 Status dir: ${this.statusDir}`);
          if (this.logDir) console.log(`📋 Log dir: ${this.logDir}`);
          resolve();
        }
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Dashboard server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// If run directly, start the server
if (require.main === module) {
  const server = new DashboardServer();
  
  server.start().catch((error) => {
    console.error('❌ Failed to start dashboard server:', error);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down dashboard...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = DashboardServer;