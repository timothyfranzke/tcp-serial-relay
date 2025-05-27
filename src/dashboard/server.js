const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

class DashboardServer {
  constructor(options = {}) {
    this.port = options.port || process.env.DASHBOARD_PORT || 3000;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    // Basic status endpoint
    this.app.get('/api/status', this.getStatus.bind(this));
    
    // Config endpoints
    this.app.get('/api/config', this.getConfig.bind(this));
    this.app.put('/api/config', this.updateConfig.bind(this));
    
    // Logs endpoint
    this.app.get('/api/logs', this.getLogs.bind(this));
    
    // Serve the main HTML file for all other routes
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  async getStatus(req, res) {
    try {
      // Read latest status file
      const statusDir = process.env.STATUS_DIR || path.join(process.cwd(), 'status');
      let latestStatus = null;

      if (fs.existsSync(statusDir)) {
        const statusFiles = fs.readdirSync(statusDir)
          .filter(f => f.startsWith('status-') && f.endsWith('.json'))
          .sort()
          .reverse();

        if (statusFiles.length > 0) {
          const statusFile = path.join(statusDir, statusFiles[0]);
          latestStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        }
      }

      const status = {
        timestamp: new Date().toISOString(),
        overall: latestStatus?.success ? 'HEALTHY' : 'UNKNOWN',
        lastRun: latestStatus,
        systemMetrics: {
          uptime: os.uptime(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpuUsage: 0,
          loadAvg: os.loadavg()
        },
        connections: {
          tcp: { connected: false },
          serial: { connected: false }
        }
      };

      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getConfig(req, res) {
    try {
      const configPath = process.env.CONFIG_PATH || 
        path.join(process.cwd(), 'config', 'relay-config.json');
      
      if (!fs.existsSync(configPath)) {
        return res.json({});
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateConfig(req, res) {
    try {
      const configPath = process.env.CONFIG_PATH || 
        path.join(process.cwd(), 'config', 'relay-config.json');
      
      fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getLogs(req, res) {
    try {
      const lines = parseInt(req.query.lines) || 50;
      const logs = [];
      
      // Generate some mock logs for now
      for (let i = 0; i < lines; i++) {
        logs.push({
          timestamp: new Date(Date.now() - i * 60000).toISOString(),
          level: ['INFO', 'WARN', 'ERROR'][Math.floor(Math.random() * 3)],
          message: `Sample log message ${i + 1}`
        });
      }
      
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`Dashboard running on http://localhost:${this.port}`);
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
  process.on('SIGINT', async () => {
    console.log('Shutting down dashboard...');
    await server.stop();
    process.exit(0);
  });
}

module.exports = DashboardServer;