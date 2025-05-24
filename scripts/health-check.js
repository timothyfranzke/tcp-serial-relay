#!/usr/bin/env node

// scripts/health-check.js
// Health monitoring script for TCP-Serial Relay

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  APP_DIR: process.env.APP_DIR || '/opt/tcp-serial-relay',
  LOG_DIR: process.env.LOG_DIR || '/var/log/tcp-serial-relay',
  CONFIG_DIR: process.env.CONFIG_DIR || '/etc/tcp-serial-relay',
  STATUS_DIR: process.env.STATUS_DIR || '/opt/tcp-serial-relay/status',
  MAX_LOG_AGE_HOURS: 24,
  MAX_STATUS_AGE_HOURS: 2,
  ALERT_THRESHOLDS: {
    diskUsagePercent: 90,
    memoryUsagePercent: 90,
    errorRatePercent: 50,
    noActivityHours: 3
  }
};

// Colors for console output
const COLORS = {
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m'
};

class HealthChecker {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      overall: 'UNKNOWN',
      checks: {},
      alerts: [],
      metrics: {}
    };
  }

  // Logging helpers
  log(level, message, data = {}) {
    const color = {
      'INFO': COLORS.BLUE,
      'WARN': COLORS.YELLOW,
      'ERROR': COLORS.RED,
      'SUCCESS': COLORS.GREEN
    }[level] || COLORS.RESET;

    console.log(`${color}[${level}] ${message}${COLORS.RESET}`);
    if (Object.keys(data).length > 0) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  // Check if files/directories exist
  checkFileSystem() {
    this.log('INFO', 'Checking file system...');
    
    const checks = {
      appDirectory: fs.existsSync(CONFIG.APP_DIR),
      logDirectory: fs.existsSync(CONFIG.LOG_DIR),
      configDirectory: fs.existsSync(CONFIG.CONFIG_DIR),
      statusDirectory: fs.existsSync(CONFIG.STATUS_DIR),
      configFile: fs.existsSync(path.join(CONFIG.CONFIG_DIR, 'relay-config.json')),
      envFile: fs.existsSync(path.join(CONFIG.CONFIG_DIR, 'relay.env')),
      cronScript: fs.existsSync(path.join(CONFIG.APP_DIR, 'scripts', 'tcp-serial-relay-cron.sh'))
    };

    this.results.checks.filesystem = checks;
    
    const allExist = Object.values(checks).every(Boolean);
    if (allExist) {
      this.log('SUCCESS', 'All required files and directories exist');
    } else {
      this.log('ERROR', 'Missing required files or directories', checks);
      this.results.alerts.push({
        severity: 'HIGH',
        message: 'Missing required filesystem components',
        details: checks
      });
    }

    return allExist;
  }

  // Check cron configuration
  checkCronJob() {
    this.log('INFO', 'Checking cron job configuration...');
    
    try {
      const crontab = execSync('sudo -u relay crontab -l 2>/dev/null || echo ""', { encoding: 'utf8' });
      const hasCronJob = crontab.includes('tcp-serial-relay-cron.sh');
      
      this.results.checks.cronjob = {
        configured: hasCronJob,
        schedule: hasCronJob ? crontab.split('\n').find(line => line.includes('tcp-serial-relay-cron.sh')) : null
      };

      if (hasCronJob) {
        this.log('SUCCESS', 'Cron job is configured');
      } else {
        this.log('ERROR', 'Cron job is not configured');
        this.results.alerts.push({
          severity: 'HIGH',
          message: 'Cron job not configured',
          details: 'The hourly cron job is not set up for the relay user'
        });
      }

      return hasCronJob;
    } catch (error) {
      this.log('ERROR', 'Failed to check cron job', { error: error.message });
      this.results.checks.cronjob = { error: error.message };
      return false;
    }
  }

  // Check recent activity from logs
  checkRecentActivity() {
    this.log('INFO', 'Checking recent activity...');
    
    const cronLogPath = path.join(CONFIG.LOG_DIR, 'cron.log');
    
    if (!fs.existsSync(cronLogPath)) {
      this.log('WARN', 'Cron log file not found');
      this.results.checks.activity = { error: 'Cron log file not found' };
      this.results.alerts.push({
        severity: 'MEDIUM',
        message: 'No cron log file found',
        details: 'The system may not have run any cron jobs yet'
      });
      return false;
    }

    try {
      const logStats = fs.statSync(cronLogPath);
      const hoursAgo = (Date.now() - logStats.mtime.getTime()) / (1000 * 60 * 60);
      
      // Read last few lines of log
      const logContent = fs.readFileSync(cronLogPath, 'utf8');
      const lines = logContent.split('\n').filter(line => line.trim());
      const recentLines = lines.slice(-10);
      
      // Count success/failure rates
      const successCount = recentLines.filter(line => line.includes('completed successfully')).length;
      const errorCount = recentLines.filter(line => line.includes('failed') || line.includes('ERROR')).length;
      const totalRuns = recentLines.filter(line => line.includes('Starting relay service')).length;
      
      this.results.checks.activity = {
        lastLogUpdate: logStats.mtime.toISOString(),
        hoursAgo: Math.round(hoursAgo * 100) / 100,
        recentRuns: totalRuns,
        successCount,
        errorCount,
        successRate: totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0
      };

      this.results.metrics.activityMetrics = this.results.checks.activity;

      // Check for alerts
      if (hoursAgo > CONFIG.ALERT_THRESHOLDS.noActivityHours) {
        this.results.alerts.push({
          severity: 'HIGH',
          message: 'No recent activity detected',
          details: `Last log update was ${hoursAgo.toFixed(1)} hours ago`
        });
      }

      if (errorCount > 0 && totalRuns > 0) {
        const errorRate = (errorCount / totalRuns) * 100;
        if (errorRate > CONFIG.ALERT_THRESHOLDS.errorRatePercent) {
          this.results.alerts.push({
            severity: 'HIGH',
            message: 'High error rate detected',
            details: `${errorRate.toFixed(1)}% of recent runs failed`
          });
        }
      }

      this.log('SUCCESS', `Activity check completed: ${successCount}/${totalRuns} successful runs`);
      return true;

    } catch (error) {
      this.log('ERROR', 'Failed to check activity', { error: error.message });
      this.results.checks.activity = { error: error.message };
      return false;
    }
  }

  // Check system resources
  checkSystemResources() {
    this.log('INFO', 'Checking system resources...');
    
    try {
      // Memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memUsagePercent = (usedMem / totalMem) * 100;

      // Disk usage
      const diskUsage = execSync("df -h / | awk 'NR==2 {print $5}' | sed 's/%//'", { encoding: 'utf8' }).trim();
      const diskUsagePercent = parseInt(diskUsage);

      // Load average
      const loadAvg = os.loadavg();

      this.results.checks.system = {
        memory: {
          total: Math.round(totalMem / (1024 * 1024 * 1024) * 100) / 100,
          free: Math.round(freeMem / (1024 * 1024 * 1024) * 100) / 100,
          used: Math.round(usedMem / (1024 * 1024 * 1024) * 100) / 100,
          usagePercent: Math.round(memUsagePercent)
        },
        disk: {
          usagePercent: diskUsagePercent
        },
        load: {
          '1min': loadAvg[0],
          '5min': loadAvg[1],
          '15min': loadAvg[2]
        },
        uptime: Math.round(os.uptime() / 3600 * 100) / 100
      };

      this.results.metrics.systemMetrics = this.results.checks.system;

      // Check thresholds
      if (memUsagePercent > CONFIG.ALERT_THRESHOLDS.memoryUsagePercent) {
        this.results.alerts.push({
          severity: 'MEDIUM',
          message: 'High memory usage',
          details: `Memory usage is ${memUsagePercent.toFixed(1)}%`
        });
      }

      if (diskUsagePercent > CONFIG.ALERT_THRESHOLDS.diskUsagePercent) {
        this.results.alerts.push({
          severity: 'HIGH',
          message: 'High disk usage',
          details: `Disk usage is ${diskUsagePercent}%`
        });
      }

      this.log('SUCCESS', 'System resources check completed');
      return true;

    } catch (error) {
      this.log('ERROR', 'Failed to check system resources', { error: error.message });
      this.results.checks.system = { error: error.message };
      return false;
    }
  }

  // Check serial ports
  checkSerialPorts() {
    this.log('INFO', 'Checking serial ports...');
    
    try {
      // Change to app directory and check serial ports
      process.chdir(CONFIG.APP_DIR);
      
      const { SerialPort } = require('serialport');
      
      return SerialPort.list().then(ports => {
        this.results.checks.serialPorts = {
          available: ports.map(port => ({
            path: port.path,
            manufacturer: port.manufacturer,
            vendorId: port.vendorId,
            productId: port.productId
          })),
          count: ports.length
        };

        if (ports.length === 0) {
          this.log('WARN', 'No serial ports detected');
          this.results.alerts.push({
            severity: 'MEDIUM',
            message: 'No serial ports detected',
            details: 'Check if serial devices are connected'
          });
        } else {
          this.log('SUCCESS', `Found ${ports.length} serial port(s)`);
          ports.forEach(port => {
            this.log('INFO', `  ${port.path} - ${port.manufacturer || 'Unknown'}`);
          });
        }

        return ports.length > 0;
      }).catch(error => {
        this.log('ERROR', 'Failed to list serial ports', { error: error.message });
        this.results.checks.serialPorts = { error: error.message };
        return false;
      });

    } catch (error) {
      this.log('ERROR', 'Failed to check serial ports', { error: error.message });
      this.results.checks.serialPorts = { error: error.message };
      return Promise.resolve(false);
    }
  }

  // Check configuration
  checkConfiguration() {
    this.log('INFO', 'Checking configuration...');
    
    try {
      const configPath = path.join(CONFIG.CONFIG_DIR, 'relay-config.json');
      
      if (!fs.existsSync(configPath)) {
        this.log('ERROR', 'Configuration file not found');
        this.results.checks.configuration = { error: 'Configuration file not found' };
        return false;
      }

      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);

      // Validate required fields
      const requiredFields = ['tcpIp', 'tcpPort', 'serialPath', 'serialBaud'];
      const missingFields = requiredFields.filter(field => !config[field]);

      this.results.checks.configuration = {
        valid: missingFields.length === 0,
        missingFields,
        tcpEndpoint: `${config.tcpIp}:${config.tcpPort}`,
        serialConfig: `${config.serialPath} @ ${config.serialBaud} baud`
      };

      if (missingFields.length > 0) {
        this.log('ERROR', 'Configuration validation failed', { missingFields });
        this.results.alerts.push({
          severity: 'HIGH',
          message: 'Invalid configuration',
          details: `Missing required fields: ${missingFields.join(', ')}`
        });
        return false;
      }

      this.log('SUCCESS', 'Configuration is valid');
      return true;

    } catch (error) {
      this.log('ERROR', 'Failed to check configuration', { error: error.message });
      this.results.checks.configuration = { error: error.message };
      return false;
    }
  }

  // Check status files
  checkStatusFiles() {
    this.log('INFO', 'Checking recent status files...');
    
    try {
      if (!fs.existsSync(CONFIG.STATUS_DIR)) {
        this.log('WARN', 'Status directory not found');
        this.results.checks.statusFiles = { error: 'Status directory not found' };
        return false;
      }

      const statusFiles = fs.readdirSync(CONFIG.STATUS_DIR)
        .filter(file => file.startsWith('status-') && file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(CONFIG.STATUS_DIR, file);
          const stats = fs.statSync(filePath);
          return {
            file,
            path: filePath,
            mtime: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      this.results.checks.statusFiles = {
        count: statusFiles.length,
        latest: statusFiles.length > 0 ? statusFiles[0] : null,
        recentFiles: statusFiles.slice(0, 5).map(f => ({
          file: f.file,
          age: Math.round((Date.now() - f.mtime.getTime()) / (1000 * 60)),
          size: f.size
        }))
      };

      if (statusFiles.length === 0) {
        this.log('WARN', 'No status files found');
        this.results.alerts.push({
          severity: 'MEDIUM',
          message: 'No status files found',
          details: 'The system may not have run successfully yet'
        });
        return false;
      }

      const latestFile = statusFiles[0];
      const hoursAgo = (Date.now() - latestFile.mtime.getTime()) / (1000 * 60 * 60);

      if (hoursAgo > CONFIG.MAX_STATUS_AGE_HOURS) {
        this.results.alerts.push({
          severity: 'MEDIUM',
          message: 'Stale status files',
          details: `Latest status file is ${hoursAgo.toFixed(1)} hours old`
        });
      }

      this.log('SUCCESS', `Found ${statusFiles.length} status files`);
      return true;

    } catch (error) {
      this.log('ERROR', 'Failed to check status files', { error: error.message });
      this.results.checks.statusFiles = { error: error.message };
      return false;
    }
  }

  // Determine overall health status
  determineOverallHealth() {
    const checks = this.results.checks;
    const alerts = this.results.alerts;

    let healthScore = 0;
    let totalChecks = 0;

    // Score each check
    Object.values(checks).forEach(check => {
      totalChecks++;
      if (check && !check.error) {
        if (typeof check === 'boolean' && check) {
          healthScore++;
        } else if (typeof check === 'object' && Object.keys(check).length > 0) {
          healthScore++;
        }
      }
    });

    const healthPercent = totalChecks > 0 ? (healthScore / totalChecks) * 100 : 0;

    // Determine status based on score and alerts
    let status = 'HEALTHY';
    
    if (healthPercent < 50) {
      status = 'CRITICAL';
    } else if (healthPercent < 80) {
      status = 'DEGRADED';
    } else if (alerts.some(alert => alert.severity === 'HIGH')) {
      status = 'WARNING';
    } else if (alerts.length > 0) {
      status = 'CAUTION';
    }

    this.results.overall = status;
    this.results.metrics.healthScore = Math.round(healthPercent);
    this.results.metrics.totalAlerts = alerts.length;
    this.results.metrics.highSeverityAlerts = alerts.filter(a => a.severity === 'HIGH').length;

    return status;
  }

  // Generate recommendations
  generateRecommendations() {
    const recommendations = [];

    // Check specific issues and provide recommendations
    if (this.results.checks.cronjob && !this.results.checks.cronjob.configured) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Configure cron job',
        command: 'echo "0 * * * * /opt/tcp-serial-relay/scripts/tcp-serial-relay-cron.sh" | sudo -u relay crontab -'
      });
    }

    if (this.results.checks.filesystem && !this.results.checks.filesystem.configFile) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Create configuration file',
        command: 'sudo cp /opt/tcp-serial-relay/src/config/default-config.js /etc/tcp-serial-relay/relay-config.json'
      });
    }

    if (this.results.checks.serialPorts && this.results.checks.serialPorts.count === 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Check serial device connections',
        command: 'lsusb && dmesg | grep tty'
      });
    }

    if (this.results.checks.system && this.results.checks.system.disk && 
        this.results.checks.system.disk.usagePercent > 80) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Clean up old log files',
        command: 'sudo find /var/log/tcp-serial-relay -name "*.log*" -mtime +7 -delete'
      });
    }

    this.results.recommendations = recommendations;
    return recommendations;
  }

  // Run all health checks
  async runAllChecks() {
    this.log('INFO', '=== Starting Health Check ===');
    
    const checkResults = {
      filesystem: this.checkFileSystem(),
      cronjob: this.checkCronJob(),
      activity: this.checkRecentActivity(),
      system: this.checkSystemResources(),
      configuration: this.checkConfiguration(),
      statusFiles: this.checkStatusFiles()
    };

    // Serial ports check is async
    checkResults.serialPorts = await this.checkSerialPorts();

    // Wait for all checks to complete
    const allPassed = Object.values(checkResults).every(Boolean);

    // Determine overall health
    const overallStatus = this.determineOverallHealth();
    
    // Generate recommendations
    this.generateRecommendations();

    this.log('INFO', '=== Health Check Complete ===');
    this.log('INFO', `Overall Status: ${overallStatus}`);
    this.log('INFO', `Health Score: ${this.results.metrics.healthScore}%`);
    
    if (this.results.alerts.length > 0) {
      this.log('WARN', `${this.results.alerts.length} alert(s) found`);
    }

    return this.results;
  }

  // Output results in different formats
  outputResults(format = 'console') {
    switch (format) {
      case 'json':
        console.log(JSON.stringify(this.results, null, 2));
        break;
      
      case 'summary':
        this.outputSummary();
        break;
      
      case 'prometheus':
        this.outputPrometheus();
        break;
      
      default:
        this.outputConsole();
    }
  }

  outputSummary() {
    console.log('\n=== HEALTH CHECK SUMMARY ===');
    console.log(`Status: ${this.results.overall}`);
    console.log(`Health Score: ${this.results.metrics.healthScore}%`);
    console.log(`Alerts: ${this.results.metrics.totalAlerts} (${this.results.metrics.highSeverityAlerts} high severity)`);
    
    if (this.results.alerts.length > 0) {
      console.log('\nALERTS:');
      this.results.alerts.forEach(alert => {
        const color = alert.severity === 'HIGH' ? COLORS.RED : COLORS.YELLOW;
        console.log(`${color}[${alert.severity}] ${alert.message}${COLORS.RESET}`);
        console.log(`  ${alert.details}`);
      });
    }

    if (this.results.recommendations && this.results.recommendations.length > 0) {
      console.log('\nRECOMMENDATIONS:');
      this.results.recommendations.forEach(rec => {
        console.log(`[${rec.priority}] ${rec.action}`);
        console.log(`  Command: ${rec.command}`);
      });
    }
  }

  outputConsole() {
    console.log('\n=== DETAILED HEALTH CHECK RESULTS ===');
    console.log(JSON.stringify(this.results, null, 2));
  }

  outputPrometheus() {
    console.log('# HELP tcp_serial_relay_health Health status of TCP-Serial Relay');
    console.log('# TYPE tcp_serial_relay_health gauge');
    console.log(`tcp_serial_relay_health{status="${this.results.overall}"} ${this.results.metrics.healthScore}`);
    
    console.log('# HELP tcp_serial_relay_alerts_total Total number of alerts');
    console.log('# TYPE tcp_serial_relay_alerts_total counter');
    console.log(`tcp_serial_relay_alerts_total ${this.results.metrics.totalAlerts}`);

    if (this.results.metrics.systemMetrics) {
      const sys = this.results.metrics.systemMetrics;
      console.log('# HELP tcp_serial_relay_memory_usage_percent Memory usage percentage');
      console.log('# TYPE tcp_serial_relay_memory_usage_percent gauge');
      console.log(`tcp_serial_relay_memory_usage_percent ${sys.memory.usagePercent}`);
      
      console.log('# HELP tcp_serial_relay_disk_usage_percent Disk usage percentage');
      console.log('# TYPE tcp_serial_relay_disk_usage_percent gauge');
      console.log(`tcp_serial_relay_disk_usage_percent ${sys.disk.usagePercent}`);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const format = args.find(arg => ['json', 'summary', 'prometheus', 'console'].includes(arg)) || 'summary';
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  if (verbose) {
    console.log('TCP-Serial Relay Health Check');
    console.log('=============================');
  }

  const checker = new HealthChecker();
  
  try {
    const results = await checker.runAllChecks();
    
    if (verbose || format === 'console') {
      checker.outputResults('console');
    } else {
      checker.outputResults(format);
    }

    // Exit with appropriate code
    const exitCode = results.overall === 'CRITICAL' ? 2 : 
                    (results.overall === 'DEGRADED' ? 1 : 0);
    
    process.exit(exitCode);

  } catch (error) {
    console.error('Health check failed:', error.message);
    process.exit(3);
  }
}

// Help text
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
TCP-Serial Relay Health Check

Usage: node health-check.js [options] [format]

Formats:
  console     Detailed console output (default)
  summary     Brief summary with alerts and recommendations
  json        JSON output for programmatic use
  prometheus  Prometheus metrics format

Options:
  --verbose, -v    Verbose output
  --help, -h       Show this help

Exit codes:
  0  Healthy
  1  Degraded (warnings)
  2  Critical (errors)
  3  Health check failed
`);
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { HealthChecker };