// Fixed dashboard/server.js - Standalone dashboard server
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SerialPort } = require('serialport');

class DashboardServer {
  constructor(options = {}) {
    this.port = options.port || process.env.DASHBOARD_PORT || process.env.PORT || 3000;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
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
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    // API Routes
    this.app.get('/api/status', this.getStatus.bind(this));
    this.app.get('/api/config', this.getConfig.bind(this));
    this.app.post('/api/config', this.updateConfig.bind(this));
    this.app.get('/api/logs', this.getLogs.bind(this));
    this.app.get('/api/health', this.getHealth.bind(this));
    this.app.get('/api/ports', this.getPorts.bind(this));
    this.app.post('/api/control/:action', this.controlService.bind(this));
    
    // Serve main dashboard for all other routes
    this.app.get('*', (req, res) => {
      const indexPath = path.join(__dirname, 'public', 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send(`
          <h1>Dashboard Not Found</h1>
          <p>Dashboard static files not found at: ${indexPath}</p>
          <p>Please run the build script to generate dashboard files.</p>
        `);
      }
    });
  }

  async getStatus(req, res) {
    try {
      // Try to read latest status from status directory
      const statusDirs = [
        process.env.STATUS_DIR,
        '/opt/tcp-serial-relay/status',
        path.join(process.cwd(), 'status'),
        path.join(__dirname, '..', '..', 'status')
      ].filter(Boolean);

      let latestStatus = null;
      
      for (const statusDir of statusDirs) {
        if (fs.existsSync(statusDir)) {
          const statusFiles = fs.readdirSync(statusDir)
            .filter(f => f.startsWith('status-') && f.endsWith('.json'))
            .sort()
            .reverse();

          if (statusFiles.length > 0) {
            const statusFile = path.join(statusDir, statusFiles[0]);
            try {
              latestStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
              break;
            } catch (error) {
              console.warn('Error reading status file:', error.message);
            }
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
      res.status(500).json({ error: error.message });
    }
  }

  async getConfig(req, res) {
    try {
      const configPaths = [
        process.env.CONFIG_PATH,
        '/etc/tcp-serial-relay/relay-config.json',
        path.join(process.cwd(), 'config', 'relay-config.json'),
        path.join(__dirname, '..', '..', 'config', 'relay-config.json')
      ].filter(Boolean);
      
      let config = {};
      
      for (const configPath of configPaths) {
        if (fs.existsSync(configPath)) {
          try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            break;
          } catch (error) {
            console.warn('Error reading config file:', error.message);
          }
        }
      }

      res.json({ config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateConfig(req, res) {
    try {
      const newConfig = req.body;
      const configPath = process.env.CONFIG_PATH || 
        path.join(process.cwd(), 'config', 'relay-config.json');
      
      // Ensure config directory exists
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
      res.json({ success: true, message: 'Configuration updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getLogs(req, res) {
    try {
      const lines = parseInt(req.query.lines) || 50;
      const logs = [];
      
      // Try to read from various log locations
      const logDirs = [
        '/var/log/tcp-serial-relay',
        path.join(process.cwd(), 'logs'),
        path.join(__dirname, '..', '..', 'logs')
      ];

      let foundLogs = false;
      
      for (const logDir of logDirs) {
        if (fs.existsSync(logDir)) {
          const logFiles = fs.readdirSync(logDir)
            .filter(f => f.endsWith('.log'))
            .sort()
            .reverse();
          
          if (logFiles.length > 0) {
            const logFile = path.join(logDir, logFiles[0]);
            try {
              const content = fs.readFileSync(logFile, 'utf8');
              const logLines = content.split('\n')
                .filter(line => line.trim())
                .slice(-lines)
                .map((line, index) => {
                  const match = line.match(/^(\S+\s+\S+)\s+\[(\w+)\]:\s+(.+)$/);
                  if (match) {
                    return {
                      timestamp: match[1],
                      level: match[2],
                      message: match[3]
                    };
                  }
                  return {
                    timestamp: new Date().toISOString(),
                    level: 'INFO',
                    message: line
                  };
                });
              logs.push(...logLines);
              foundLogs = true;
              break;
            } catch (error) {
              console.warn('Error reading log file:', error.message);
            }
          }
        }
      }

      if (!foundLogs) {
        // Generate sample logs if no real logs found
        for (let i = 0; i < Math.min(lines, 10); i++) {
          logs.push({
            timestamp: new Date(Date.now() - i * 60000).toISOString(),
            level: 'INFO',
            message: `No log files found in standard locations (sample entry ${i + 1})`
          });
        }
      }
      
      res.json({ logs: logs.reverse() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getHealth(req, res) {
    try {
      const health = {
        status: 'unknown',
        uptime: process.uptime() * 1000,
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
      res.status(500).json({ error: error.message });
    }
  }

  async getPorts(req, res) {
    try {
      const ports = await SerialPort.list();
      res.json({ ports });
    } catch (error) {
      console.warn('Error listing serial ports:', error.message);
      res.json({ ports: [], error: 'Could not list serial ports' });
    }
  }

  async controlService(req, res) {
    try {
      const action = req.params.action;
      const { spawn } = require('child_process');
      
      switch (action) {
        case 'start':
          // This would typically interface with the actual service
          res.json({ success: true, message: 'Start command received (dashboard-only mode)' });
          break;
        case 'stop':
          res.json({ success: true, message: 'Stop command received (dashboard-only mode)' });
          break;
        case 'restart':
          res.json({ success: true, message: 'Restart command received (dashboard-only mode)' });
          break;
        default:
          res.status(400).json({ error: 'Unknown action' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '0.0.0.0', (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`✅ Dashboard server started successfully`);
          console.log(`🌐 Dashboard URL: http://localhost:${this.port}`);
          console.log(`📁 Static files: ${path.join(__dirname, 'public')}`);
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
    console.error('Failed to start dashboard server:', error);
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