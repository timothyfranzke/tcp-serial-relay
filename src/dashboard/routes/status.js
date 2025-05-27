// src/dashboard/routes/status.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

class StatusRoutes {
  constructor() {
    this.statusDir = process.env.STATUS_DIR || '/opt/tcp-serial-relay/status';
    this.logDir = process.env.LOG_DIR || '/var/log/tcp-serial-relay';
  }

  // GET /api/status
  async getStatus(req, res) {
    try {
      const status = {
        timestamp: new Date().toISOString(),
        lastRun: await this.getLastRunStatus(),
        cronStatus: await this.getCronStatus(),
        systemHealth: await this.getSystemHealth(),
        recentRuns: await this.getRecentRuns(),
        serialPorts: await this.getSerialPorts()
      };

      res.json(status);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get status',
        message: error.message 
      });
    }
  }

  // GET /api/status/runs
  async getRecentRuns(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const runs = await this.getRecentRuns(limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get recent runs',
        message: error.message 
      });
    }
  }

  // GET /api/status/health
  async getSystemHealth(req, res) {
    try {
      const health = await this.getSystemHealth();
      res.json(health);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get system health',
        message: error.message 
      });
    }
  }

  async getLastRunStatus() {
    try {
      if (!fs.existsSync(this.statusDir)) {
        return null;
      }

      const statusFiles = fs.readdirSync(this.statusDir)
        .filter(file => file.startsWith('status-') && file.endsWith('.json'))
        .sort()
        .reverse();

      if (statusFiles.length === 0) {
        return null;
      }

      const latestFile = path.join(this.statusDir, statusFiles[0]);
      const statusData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      
      // Add file metadata
      const stats = fs.statSync(latestFile);
      statusData.fileAge = Date.now() - stats.mtime.getTime();
      
      return statusData;
    } catch (error) {
      throw new Error(`Failed to read last run status: ${error.message}`);
    }
  }

  async getCronStatus() {
    try {
      const cronStatus = {
        enabled: false,
        schedule: null,
        nextRun: null,
        lastSuccess: null,
        isActive: false
      };

      // Check if cron job is configured
      try {
        const { stdout } = await execAsync('sudo -u relay crontab -l 2>/dev/null || echo ""');
        const cronLine = stdout.split('\n').find(line => 
          line.includes('tcp-serial-relay-cron.sh') || 
          line.includes('tcp-serial-relay')
        );

        if (cronLine && !cronLine.startsWith('#')) {
          cronStatus.enabled = true;
          cronStatus.schedule = cronLine.split(' ').slice(0, 5).join(' ');
          cronStatus.nextRun = this.calculateNextCronRun(cronStatus.schedule);
        }
      } catch (error) {
        // Cron check failed, leave as disabled
      }

      // Check recent cron activity from logs
      const cronLogPath = path.join(this.logDir, 'cron.log');
      if (fs.existsSync(cronLogPath)) {
        try {
          const logContent = fs.readFileSync(cronLogPath, 'utf8');
          const lines = logContent.split('\n').filter(line => line.trim());
          
          // Find last successful run
          const successLines = lines.filter(line => 
            line.includes('completed successfully')
          ).reverse();
          
          if (successLines.length > 0) {
            // Extract timestamp from log line
            const match = successLines[0].match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
            if (match) {
              cronStatus.lastSuccess = new Date(match[1]).toISOString();
            }
          }

          // Check if cron has run recently (within last 2 hours)
          const recentLines = lines.filter(line => {
            const match = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
            if (match) {
              const logTime = new Date(match[1]).getTime();
              return (Date.now() - logTime) < (2 * 60 * 60 * 1000); // 2 hours
            }
            return false;
          });
          
          cronStatus.isActive = recentLines.length > 0;
        } catch (error) {
          // Log reading failed
        }
      }

      return cronStatus;
    } catch (error) {
      throw new Error(`Failed to get cron status: ${error.message}`);
    }
  }

  async getSystemHealth() {
    try {
      const health = {
        uptime: os.uptime(),
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          used: os.totalmem() - os.freemem(),
          usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
        },
        loadAverage: os.loadavg(),
        diskSpace: null,
        temperature: null
      };

      // Get disk usage
      try {
        const { stdout } = await execAsync("df -h / | awk 'NR==2 {print $5}' | sed 's/%//'");
        health.diskSpace = {
          usagePercent: parseInt(stdout.trim())
        };
      } catch (error) {
        // Disk check failed
      }

      // Get CPU temperature (Raspberry Pi specific)
      try {
        const { stdout } = await execAsync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null');
        health.temperature = {
          celsius: parseInt(stdout.trim()) / 1000
        };
      } catch (error) {
        // Temperature check failed (not a Pi or no access)
      }

      return health;
    } catch (error) {
      throw new Error(`Failed to get system health: ${error.message}`);
    }
  }

  async getRecentRuns(limit = 20) {
    try {
      if (!fs.existsSync(this.statusDir)) {
        return [];
      }

      const statusFiles = fs.readdirSync(this.statusDir)
        .filter(file => file.startsWith('status-') && file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(this.statusDir, file);
          const stats = fs.statSync(filePath);
          return {
            file,
            path: filePath,
            mtime: stats.mtime
          };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      const runs = [];
      for (const fileInfo of statusFiles) {
        try {
          const statusData = JSON.parse(fs.readFileSync(fileInfo.path, 'utf8'));
          runs.push({
            timestamp: statusData.runTimestamp || fileInfo.mtime.toISOString(),
            success: statusData.success || false,
            duration: statusData.duration || 0,
            message: statusData.message || 'Unknown',
            metrics: statusData.metrics || {},
            file: fileInfo.file
          });
        } catch (error) {
          // Skip malformed status files
          runs.push({
            timestamp: fileInfo.mtime.toISOString(),
            success: false,
            duration: 0,
            message: 'Failed to parse status file',
            file: fileInfo.file,
            error: true
          });
        }
      }

      return runs;
    } catch (error) {
      throw new Error(`Failed to get recent runs: ${error.message}`);
    }
  }

  async getSerialPorts() {
    try {
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      return ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer,
        vendorId: port.vendorId,
        productId: port.productId
      }));
    } catch (error) {
      return [];
    }
  }

  calculateNextCronRun(schedule) {
    try {
      // Simple cron calculation for common patterns
      // This is a basic implementation - could use a library like 'cron-parser' for full support
      const [minute, hour, day, month, weekday] = schedule.split(' ');
      const now = new Date();
      const next = new Date(now);

      if (minute === '*' && hour === '*') {
        // Every minute
        next.setMinutes(next.getMinutes() + 1);
      } else if (minute !== '*' && hour === '*') {
        // Every hour at specific minute
        next.setMinutes(parseInt(minute));
        if (next <= now) {
          next.setHours(next.getHours() + 1);
        }
      } else if (minute !== '*' && hour !== '*') {
        // Specific time daily
        next.setHours(parseInt(hour), parseInt(minute), 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
      }

      return next.toISOString();
    } catch (error) {
      return null;
    }
  }
}

module.exports = StatusRoutes;