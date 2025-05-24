// src/services/dashboard-server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { logger } = require('../utils/logger');
const { getStatus, statusManager } = require('../utils/status-manager');
const { loadConfig, updateConfig } = require('../config');

/**
 * Dashboard Server for TCP-Serial Relay monitoring and control
 */
class DashboardServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 3000;
    this.host = options.host || '0.0.0.0';
    this.server = null;
    this.wsClients = new Set();
    this.logBuffer = [];
    this.maxLogEntries = 1000;
    
    // Dashboard static files
    this.staticDir = path.join(__dirname, '../../dashboard');
    this.ensureStaticDir();
  }

  /**
   * Ensure dashboard static directory exists and create index.html
   */
  ensureStaticDir() {
    if (!fs.existsSync(this.staticDir)) {
      fs.mkdirSync(this.staticDir, { recursive: true });
    }
    
    // Copy the dashboard HTML to static directory
    const dashboardHtml = this.getDashboardHtml();
    const indexPath = path.join(this.staticDir, 'index.html');
    fs.writeFileSync(indexPath, dashboardHtml, 'utf8');
  }

  /**
   * Get the dashboard HTML content
   */
  getDashboardHtml() {
    // This would contain the full HTML from the artifact
    // For brevity, returning a reference - in real implementation,
    // you'd include the full HTML content here
    return `<!DOCTYPE html>
<html>
<head>
    <title>TCP-Serial Relay Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Include the full dashboard HTML content here -->
</head>
<body>
    <div id="app">Loading dashboard...</div>
    <script>
        // Dashboard JavaScript will be injected here
        // Including WebSocket connection for real-time updates
        const ws = new WebSocket('ws://localhost:3000/ws');
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            updateDashboard(data);
        };
        
        function updateDashboard(data) {
            // Update dashboard with real-time data
            if (data.type === 'status') {
                currentStatus = data.payload;
                updateStatus();
            } else if (data.type === 'log') {
                addLog(data.payload.level, data.payload.message);
            } else if (data.type === 'config') {
                config = data.payload;
                loadConfig();
            }
        }
        
        // API functions for dashboard
        async function apiCall(endpoint, method = 'GET', data = null) {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };
            
            if (data) {
                options.body = JSON.stringify(data);
            }
            
            const response = await fetch('/api' + endpoint + ', options);
            return response.json();
        }
        
        // Override the mock functions with real API calls
        async function loadConfig() {
            try {
                const response = await apiCall('/config');
                config = response.config;
                // Update form fields
                document.getElementById('tcp-ip').value = config.tcpIp;
                document.getElementById('tcp-port').value = config.tcpPort;
                document.getElementById('serial-path').value = config.serialPath;
                document.getElementById('serial-baud').value = config.serialBaud;
                document.getElementById('serial-parity').value = config.serialParity;
                document.getElementById('log-level').value = config.logLevel;
            } catch (error) {
                console.error('Failed to load config:', error);
            }
        }
        
        async function saveConfig() {
            try {
                const newConfig = {
                    tcpIp: document.getElementById('tcp-ip').value,
                    tcpPort: parseInt(document.getElementById('tcp-port').value),
                    serialPath: document.getElementById('serial-path').value,
                    serialBaud: parseInt(document.getElementById('serial-baud').value),
                    serialParity: document.getElementById('serial-parity').value,
                    logLevel: document.getElementById('log-level').value
                };
                
                await apiCall('/config', 'POST', newConfig);
                addLog('info', 'Configuration saved successfully');
            } catch (error) {
                addLog('error', 'Failed to save configuration');
            }
        }
        
        async function startService() {
            try {
                await apiCall('/control/start', 'POST');
                addLog('info', 'Start command sent');
            } catch (error) {
                addLog('error', 'Failed to start service');
            }
        }
        
        async function stopService() {
            try {
                await apiCall('/control/stop', 'POST');
                addLog('info', 'Stop command sent');
            } catch (error) {
                addLog('error', 'Failed to stop service');
            }
        }
        
        async function restartService() {
            try {
                await apiCall('/control/restart', 'POST');
                addLog('info', 'Restart command sent');
            } catch (error) {
                addLog('error', 'Failed to restart service');
            }
        }
        
        async function checkHealth() {
            try {
                const health = await apiCall('/health');
                const controlOutput = document.getElementById('control-output');
                controlOutput.innerHTML = \`
                    <div class="log-entry"><span class="log-message">Health Check Results:</span></div>
                    <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Overall Status: \${health.status}</span></div>
                    <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Uptime: \${health.uptime}ms</span></div>
                    <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Health Score: \${health.healthScore || 'N/A'}</span></div>
                \`;
            } catch (error) {
                addLog('error', 'Health check failed');
            }
        }
    </script>
</body>
</html>`;
  }

  /**
   * Start the dashboard server
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Add WebSocket support for real-time updates
      this.setupWebSocket();

      this.server.listen(this.port, this.host, (error) => {
        if (error) {
          logger.error('Failed to start dashboard server', { error: error.message });
          reject(error);
        } else {
          logger.info('Dashboard server started', {
            host: this.host,
            port: this.port,
            url: `http://${this.host === '0.0.0.0' ? 'localhost' : this.host}:${this.port}`
          });
          resolve();
        }
      });

      // Start broadcasting status updates
      this.startStatusBroadcast();
    });
  }

  /**
   * Setup WebSocket for real-time communication
   */
  setupWebSocket() {
    this.server.on('upgrade', (request, socket, head) => {
      if (request.url === '/ws') {
        this.handleWebSocketConnection(socket, head);
      }
    });
  }

  /**
   * Handle WebSocket connections
   */
  handleWebSocketConnection(socket, head) {
    const ws = this.createWebSocketConnection(socket, head);
    this.wsClients.add(ws);

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });

    // Send initial data
    this.sendToClient(ws, 'status', this.getCurrentStatus());
    this.sendToClient(ws, 'config', { config: this.getCurrentConfig() });
  }

  /**
   * Create WebSocket connection (simplified implementation)
   */
  createWebSocketConnection(socket, head) {
    // In a real implementation, you'd use a proper WebSocket library like 'ws'
    // This is a simplified version for demonstration
    const ws = {
      send: (data) => {
        try {
          socket.write(`data: ${data}\n\n`);
        } catch (error) {
          // Connection closed
        }
      },
      close: () => socket.end(),
      on: (event, callback) => {
        if (event === 'close') {
          socket.on('close', callback);
        }
      }
    };

    return ws;
  }

  /**
   * Handle HTTP requests
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // API routes
      if (pathname.startsWith('/api/')) {
        await this.handleApiRequest(req, res, pathname.substring(4));
        return;
      }

      // Static file serving
      if (pathname === '/' || pathname === '/index.html') {
        this.serveFile(res, path.join(this.staticDir, 'index.html'), 'text/html');
      } else {
        this.serveFile(res, path.join(this.staticDir, pathname), this.getContentType(pathname));
      }

    } catch (error) {
      logger.error('Request handling error', { error: error.message, url: req.url });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Handle API requests
   */
  async handleApiRequest(req, res, path) {
    const method = req.method;
    const body = await this.getRequestBody(req);

    logger.debug('API request', { method, path, body });

    switch (path) {
      case 'status':
        if (method === 'GET') {
          this.sendJson(res, { status: this.getCurrentStatus() });
        }
        break;

      case 'config':
        if (method === 'GET') {
          this.sendJson(res, { config: this.getCurrentConfig() });
        } else if (method === 'POST') {
          await this.updateConfiguration(body);
          this.sendJson(res, { success: true, message: 'Configuration updated' });
        }
        break;

      case 'logs':
        if (method === 'GET') {
          this.sendJson(res, { logs: this.getRecentLogs() });
        }
        break;

      case 'health':
        if (method === 'GET') {
          this.sendJson(res, this.getHealthStatus());
        }
        break;

      case 'control/start':
        if (method === 'POST') {
          this.emit('start-service');
          this.sendJson(res, { success: true, message: 'Start command issued' });
        }
        break;

      case 'control/stop':
        if (method === 'POST') {
          this.emit('stop-service');
          this.sendJson(res, { success: true, message: 'Stop command issued' });
        }
        break;

      case 'control/restart':
        if (method === 'POST') {
          this.emit('restart-service');
          this.sendJson(res, { success: true, message: 'Restart command issued' });
        }
        break;

      case 'ports':
        if (method === 'GET') {
          const SerialClient = require('./serial-client');
          const ports = await SerialClient.listPorts();
          this.sendJson(res, { ports });
        }
        break;

      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API endpoint not found' }));
    }
  }

  /**
   * Get request body
   */
  async getRequestBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          resolve({});
        }
      });
    });
  }

  /**
   * Send JSON response
   */
  sendJson(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Serve static files
   */
  serveFile(res, filePath, contentType) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
    }
  }

  /**
   * Get content type for file extension
   */
  getContentType(pathname) {
    const ext = path.extname(pathname).toLowerCase();
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon'
    };
    return types[ext] || 'application/octet-stream';
  }

  /**
   * Get current status from status manager
   */
  getCurrentStatus() {
    return getStatus();
  }

  /**
   * Get current configuration
   */
  getCurrentConfig() {
    try {
      const configPath = path.join(process.cwd(), 'config', 'relay-config.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (error) {
      logger.warn('Failed to read current config', { error: error.message });
    }
    
    return {
      tcpIp: '192.168.1.90',
      tcpPort: 10002,
      serialPath: '/dev/ttyUSB0',
      serialBaud: 9600,
      serialParity: 'odd',
      logLevel: 'info'
    };
  }

  /**
   * Update configuration
   */
  async updateConfiguration(newConfig) {
    try {
      await updateConfig(newConfig);
      this.broadcastToClients('config', { config: newConfig });
      logger.info('Configuration updated via dashboard', newConfig);
    } catch (error) {
      logger.error('Failed to update configuration', { error: error.message });
      throw error;
    }
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    const status = this.getCurrentStatus();
    return {
      status: status.success ? 'healthy' : 'error',
      uptime: status.duration,
      connections: status.connections,
      metrics: status.metrics
    };
  }

  /**
   * Get recent logs
   */
  getRecentLogs() {
    return this.logBuffer.slice(-100); // Return last 100 log entries
  }

  /**
   * Add log entry to buffer
   */
  addLogEntry(level, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata
    };
    
    this.logBuffer.push(logEntry);
    
    // Keep buffer size manageable
    if (this.logBuffer.length > this.maxLogEntries) {
      this.logBuffer = this.logBuffer.slice(-this.maxLogEntries + 100);
    }
    
    // Broadcast to connected clients
    this.broadcastToClients('log', logEntry);
  }

  /**
   * Start broadcasting status updates
   */
  startStatusBroadcast() {
    setInterval(() => {
      if (this.wsClients.size > 0) {
        const status = this.getCurrentStatus();
        this.broadcastToClients('status', status);
      }
    }, 2000); // Update every 2 seconds
  }

  /**
   * Broadcast data to all connected WebSocket clients
   */
  broadcastToClients(type, payload) {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    
    for (const client of this.wsClients) {
      try {
        client.send(message);
      } catch (error) {
        // Remove failed client
        this.wsClients.delete(client);
      }
    }
  }

  /**
   * Send data to specific client
   */
  sendToClient(client, type, payload) {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    try {
      client.send(message);
    } catch (error) {
      // Client connection failed
      this.wsClients.delete(client);
    }
  }

  /**
   * Stop the dashboard server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        // Close all WebSocket connections
        for (const client of this.wsClients) {
          try {
            client.close();
          } catch (error) {
            // Ignore errors when closing
          }
        }
        this.wsClients.clear();

        this.server.close(() => {
          logger.info('Dashboard server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = DashboardServer;