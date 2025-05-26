const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Logger utility
const logger = {
  info: console.info,
  error: console.error,
  warn: console.warn,
  debug: console.debug
};

// Cache for status data
let statusCache = null;
let statusCacheTime = 0;
const statusCacheTimeout = 5000; // 5 seconds

// Helper function to load config
function loadConfig() {
  try {
    const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), '..', 'config', 'relay-config.json');
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    logger.error('Failed to load config', { error: error.message });
    return {};
  }
}

// Helper function to update config
function updateConfig(newConfig) {
  try {
    const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), '..', 'config', 'relay-config.json');
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    return true;
  } catch (error) {
    logger.error('Failed to update config', { error: error.message });
    return false;
  }
}

// Helper function to get device info
function getDeviceInfo() {
  return {
    model: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release()
  };
}

// Helper function to check if service is running
async function isServiceRunning() {
  try {
    const { stdout } = await execAsync("ps aux | grep '[n]ode.*app.js' | wc -l");
    return parseInt(stdout.trim()) > 0;
  } catch (error) {
    logger.error('Error checking if service is running', { error: error.message });
    return false;
  }
}

// Helper function to get system metrics
async function getSystemMetrics() {
  try {
    const metrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      uptime: os.uptime(),
      freeMemory: os.freemem(),
      totalMemory: os.totalmem()
    };
    
    // Get CPU usage
    const { stdout: cpuStdout } = await execAsync("top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'");
    metrics.cpuUsage = parseFloat(cpuStdout.trim());
    
    return metrics;
  } catch (error) {
    logger.error('Error getting system metrics', { error: error.message });
    return {
      cpuUsage: 0,
      memoryUsage: 0,
      uptime: os.uptime(),
      freeMemory: os.freemem(),
      totalMemory: os.totalmem()
    };
  }
}

// Helper function to collect system status
async function collectSystemStatus() {
  // Return from cache if available and not expired
  if (statusCache && (Date.now() - statusCacheTime < statusCacheTimeout)) {
    return statusCache;
  }
  
  const status = {
    timestamp: new Date().toISOString(),
    deviceInfo: getDeviceInfo(),
    overall: 'UNKNOWN',
    connections: {
      tcp: { connected: false },
      serial: { connected: false }
    },
    metrics: {
      totalConnections: 0,
      dataTransfers: 0,
      bytesTransferredTcpToSerial: 0,
      bytesTransferredSerialToTcp: 0,
      errors: 0
    },
    uptime: 0,
    lastUpdate: new Date().toISOString()
  };

  try {
    // Check if service is running
    const running = await isServiceRunning();
    
    if (running) {
      status.overall = 'HEALTHY';
      status.connections.tcp.connected = true;
      status.connections.serial.connected = true;
    } else {
      status.overall = 'STOPPED';
    }

    // Get system metrics
    const systemMetrics = await getSystemMetrics();
    status.systemMetrics = systemMetrics;

    // Update cache
    statusCache = status;
    statusCacheTime = Date.now();
    
    return status;
  } catch (error) {
    logger.error('Error collecting system status', { error: error.message });
    return status;
  }
}

// API Routes
// Get status
app.get('/api/status', async (req, res) => {
  try {
    const status = await collectSystemStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get config
app.get('/api/config', (req, res) => {
  try {
    const config = loadConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update config
app.put('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    const success = updateConfig(newConfig);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to update config' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get logs
app.get('/api/logs', (req, res) => {
  try {
    const lines = parseInt(req.query.lines || '50');
    // For simplicity, we'll use mock logs
    const mockLogs = [];
    for (let i = 0; i < lines; i++) {
      const timestamp = new Date(Date.now() - i * 60000);
      const levels = ['INFO', 'WARN', 'ERROR'];
      const level = levels[Math.floor(Math.random() * levels.length)];
      mockLogs.push({
        timestamp: timestamp.toISOString(),
        level,
        message: `Sample log message ${i+1}`
      });
    }
    res.json(mockLogs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Service control
app.post('/api/service', async (req, res) => {
  try {
    const { action } = req.body;
    
    if (action === 'start') {
      // Logic to start the service
      res.json({ success: true, message: 'Service started' });
    } else if (action === 'stop') {
      // Logic to stop the service
      res.json({ success: true, message: 'Service stopped' });
    } else if (action === 'restart') {
      // Logic to restart the service
      res.json({ success: true, message: 'Service restarted' });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the main HTML file for all other routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback route for any other paths
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Dashboard server running on port ${port}`);
});