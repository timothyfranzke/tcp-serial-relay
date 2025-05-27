// src/dashboard/routes/logs.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class LogsRoutes {
  constructor() {
    this.logDir = process.env.LOG_DIR || '/var/log/tcp-serial-relay';
    this.appLogDir = process.env.APP_LOG_DIR || '/opt/tcp-serial-relay/logs';
  }

  // GET /api/logs
  async getLogs(req, res) {
    try {
      const {
        type = 'app',
        lines = 100,
        level = 'all',
        since = null,
        follow = false
      } = req.query;

      const logs = await this.readLogs(type, {
        lines: parseInt(lines),
        level,
        since,
        follow: follow === 'true'
      });

      res.json(logs);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to read logs',
        message: error.message 
      });
    }
  }

  // GET /api/logs/files
  async getLogFiles(req, res) {
    try {
      const files = await this.listLogFiles();
      res.json(files);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to list log files',
        message: error.message 
      });
    }
  }

  // GET /api/logs/download/:filename
  async downloadLog(req, res) {
    try {
      const { filename } = req.params;
      const filePath = this.getSecureLogPath(filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Log file not found' });
      }

      res.download(filePath, filename);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to download log',
        message: error.message 
      });
    }
  }

  // GET /api/logs/tail/:filename
  async tailLog(req, res) {
    try {
      const { filename } = req.params;
      const lines = parseInt(req.query.lines) || 50;
      const filePath = this.getSecureLogPath(filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Log file not found' });
      }

      const tailOutput = await this.tailFile(filePath, lines);
      res.json({ 
        filename,
        lines: tailOutput.map(line => this.parseLogLine(line))
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to tail log',
        message: error.message 
      });
    }
  }

  // GET /api/logs/search
  async searchLogs(req, res) {
    try {
      const { 
        query, 
        type = 'app', 
        caseSensitive = false,
        maxResults = 100 
      } = req.query;

      if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
      }

      const results = await this.searchInLogs(query, {
        type,
        caseSensitive: caseSensitive === 'true',
        maxResults: parseInt(maxResults)
      });

      res.json(results);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to search logs',
        message: error.message 
      });
    }
  }

  // GET /api/logs/stats
  async getLogStats(req, res) {
    try {
      const { type = 'app', hours = 24 } = req.query;
      const stats = await this.calculateLogStats(type, parseInt(hours));
      res.json(stats);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get log statistics',
        message: error.message 
      });
    }
  }

  async readLogs(type, options = {}) {
    const { lines = 100, level = 'all', since = null } = options;
    
    let logFile;
    switch (type) {
      case 'cron':
        logFile = path.join(this.logDir, 'cron.log');
        break;
      case 'error':
        logFile = this.getLatestLogFile('error-*.log');
        break;
      case 'data':
        logFile = this.getLatestLogFile('data-transfer-*.log');
        break;
      case 'exceptions':
        logFile = this.getLatestLogFile('exceptions-*.log');
        break;
      case 'rejections':
        logFile = this.getLatestLogFile('rejections-*.log');
        break;
      case 'app':
      default:
        logFile = this.getLatestLogFile('app-*.log');
        break;
    }

    if (!logFile || !fs.existsSync(logFile)) {
      return [];
    }

    try {
      let content;
      
      if (lines > 0) {
        // Use tail for performance with large files
        const tailOutput = await this.tailFile(logFile, lines);
        content = tailOutput.join('\n');
      } else {
        content = fs.readFileSync(logFile, 'utf8');
      }

      const logLines = content.split('\n').filter(line => line.trim());
      const parsedLogs = [];

      for (const line of logLines) {
        const parsedLog = this.parseLogLine(line);
        
        if (parsedLog) {
          // Filter by level
          if (level !== 'all' && parsedLog.level.toLowerCase() !== level.toLowerCase()) {
            continue;
          }

          // Filter by time
          if (since) {
            const sinceDate = new Date(since);
            const logDate = new Date(parsedLog.timestamp);
            if (logDate < sinceDate) {
              continue;
            }
          }

          parsedLogs.push(parsedLog);
        }
      }

      return parsedLogs.reverse(); // Most recent first
    } catch (error) {
      throw new Error(`Failed to read log file ${logFile}: ${error.message}`);
    }
  }

  async listLogFiles() {
    const files = [];
    
    // Check system log directory
    if (fs.existsSync(this.logDir)) {
      const systemFiles = fs.readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .map(file => {
          const filePath = path.join(this.logDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            type: 'system',
            size: stats.size,
            modified: stats.mtime.toISOString(),
            category: this.categorizeLogFile(file),
            humanSize: this.formatFileSize(stats.size)
          };
        });
      
      files.push(...systemFiles);
    }

    // Check application log directory
    if (fs.existsSync(this.appLogDir)) {
      const appFiles = fs.readdirSync(this.appLogDir)
        .filter(file => file.endsWith('.log'))
        .map(file => {
          const filePath = path.join(this.appLogDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            type: 'application',
            size: stats.size,
            modified: stats.mtime.toISOString(),
            category: this.categorizeLogFile(file),
            humanSize: this.formatFileSize(stats.size)
          };
        });
      
      files.push(...appFiles);
    }

    return files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  }

  async tailFile(filePath, lines) {
    try {
      const { stdout } = await execAsync(`tail -n ${lines} "${filePath}"`);
      return stdout.trim().split('\n').filter(line => line.trim());
    } catch (error) {
      // Fallback to reading file if tail fails
      const content = fs.readFileSync(filePath, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      return allLines.slice(-lines);
    }
  }

  async searchInLogs(searchQuery, options = {}) {
    const { type = 'app', caseSensitive = false, maxResults = 100 } = options;
    const results = [];
    
    const logFiles = await this.listLogFiles();
    const filteredFiles = type === 'all' ? logFiles : 
      logFiles.filter(file => file.category === type);

    for (const logFile of filteredFiles) {
      if (results.length >= maxResults) break;

      try {
        const grepFlags = caseSensitive ? '' : '-i';
        const { stdout } = await execAsync(
          `grep ${grepFlags} -n "${searchQuery}" "${logFile.path}" | head -${maxResults - results.length}`
        );

        const matches = stdout.trim().split('\n').filter(line => line.trim());
        
        for (const match of matches) {
          const colonIndex = match.indexOf(':');
          if (colonIndex > 0) {
            const lineNumber = parseInt(match.substring(0, colonIndex));
            const content = match.substring(colonIndex + 1);
            const parsedLog = this.parseLogLine(content);

            results.push({
              file: logFile.name,
              lineNumber,
              content,
              parsed: parsedLog,
              match: searchQuery,
              context: await this.getLogContext(logFile.path, lineNumber)
            });
          }
        }
      } catch (error) {
        // File might not contain matches or be inaccessible
        continue;
      }
    }

    return results;
  }

  async calculateLogStats(type, hours) {
    try {
      const sinceTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
      const logs = await this.readLogs(type, { since: sinceTime.toISOString() });

      const stats = {
        totalEntries: logs.length,
        timeRange: {
          start: sinceTime.toISOString(),
          end: new Date().toISOString(),
          hours
        },
        levelDistribution: {},
        entriesPerHour: {},
        errors: 0,
        warnings: 0
      };

      // Calculate level distribution and hourly breakdown
      for (const log of logs) {
        const level = log.level.toUpperCase();
        stats.levelDistribution[level] = (stats.levelDistribution[level] || 0) + 1;

        if (level === 'ERROR') stats.errors++;
        if (level === 'WARN' || level === 'WARNING') stats.warnings++;

        // Group by hour
        const hour = new Date(log.timestamp).toISOString().substring(0, 13) + ':00:00.000Z';
        stats.entriesPerHour[hour] = (stats.entriesPerHour[hour] || 0) + 1;
      }

      return stats;
    } catch (error) {
      throw new Error(`Failed to calculate log stats: ${error.message}`);
    }
  }

  async getLogContext(filePath, lineNumber, contextLines = 3) {
    try {
      const startLine = Math.max(1, lineNumber - contextLines);
      const endLine = lineNumber + contextLines;
      
      const { stdout } = await execAsync(
        `sed -n '${startLine},${endLine}p' "${filePath}"`
      );

      return stdout.trim().split('\n').map((line, index) => ({
        lineNumber: startLine + index,
        content: line,
        isMatch: startLine + index === lineNumber
      }));
    } catch (error) {
      return [];
    }
  }

  parseLogLine(line) {
    // Try to parse different log formats
    
    // Winston format: 2025-01-27 10:30:45.123 [INFO]: Message
    const winstonMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\]: (.+)$/);
    if (winstonMatch) {
      const [, timestamp, level, message] = winstonMatch;
      return {
        timestamp,
        level,
        message,
        raw: line,
        formatted: true
      };
    }

    // Cron log format: [2025-01-27 10:30:45] Message
    const cronMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (.+)$/);
    if (cronMatch) {
      const [, timestamp, message] = cronMatch;
      return {
        timestamp,
        level: this.inferLogLevel(message),
        message,
        raw: line,
        formatted: true
      };
    }

    // Simple timestamp format: 2025-01-27T10:30:45.123Z Message
    const simpleMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.+)$/);
    if (simpleMatch) {
      const [, timestamp, message] = simpleMatch;
      return {
        timestamp,
        level: this.inferLogLevel(message),
        message,
        raw: line,
        formatted: true
      };
    }

    // JSON log format
    try {
      const jsonLog = JSON.parse(line);
      if (jsonLog.timestamp && jsonLog.message) {
        return {
          timestamp: jsonLog.timestamp,
          level: jsonLog.level || 'INFO',
          message: jsonLog.message,
          raw: line,
          formatted: true,
          metadata: jsonLog
        };
      }
    } catch (error) {
      // Not JSON format
    }

    // Fallback - treat as plain message with current timestamp
    return {
      timestamp: new Date().toISOString(),
      level: this.inferLogLevel(line),
      message: line,
      raw: line,
      formatted: false
    };
  }

  inferLogLevel(message) {
    const messageLower = message.toLowerCase();
    
    if (messageLower.includes('error') || messageLower.includes('fail') || messageLower.includes('exception')) {
      return 'ERROR';
    }
    
    if (messageLower.includes('warn') || messageLower.includes('warning')) {
      return 'WARN';
    }
    
    if (messageLower.includes('debug')) {
      return 'DEBUG';
    }
    
    if (messageLower.includes('completed successfully') || messageLower.includes('success')) {
      return 'INFO';
    }
    
    return 'INFO';
  }

  getLatestLogFile(pattern) {
    const directories = [this.logDir, this.appLogDir];
    
    for (const dir of directories) {
      if (!fs.existsSync(dir)) continue;
      
      const files = fs.readdirSync(dir)
        .filter(file => {
          if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(file);
          }
          return file === pattern;
        })
        .map(file => {
          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          return { file: filePath, mtime: stats.mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        return files[0].file;
      }
    }

    return null;
  }

  categorizeLogFile(filename) {
    if (filename.includes('cron')) return 'cron';
    if (filename.includes('error')) return 'error';
    if (filename.includes('data-transfer')) return 'data';
    if (filename.includes('exception')) return 'exceptions';
    if (filename.includes('rejection')) return 'rejections';
    return 'app';
  }

  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  getSecureLogPath(filename) {
    // Prevent directory traversal attacks
    const sanitized = path.basename(filename);
    
    // Check in both log directories
    const systemPath = path.join(this.logDir, sanitized);
    const appPath = path.join(this.appLogDir, sanitized);
    
    if (fs.existsSync(systemPath)) {
      return systemPath;
    }
    
    if (fs.existsSync(appPath)) {
      return appPath;
    }
    
    throw new Error('Log file not found or access denied');
  }

  // WebSocket endpoint for real-time log streaming
  setupLogStreaming(io) {
    io.on('connection', (socket) => {
      console.log('Client connected for log streaming');
      
      socket.on('start-tail', (data) => {
        const { filename, lines = 50 } = data;
        
        try {
          const filePath = this.getSecureLogPath(filename);
          
          // Send initial content
          this.tailFile(filePath, lines).then(initialLines => {
            socket.emit('log-data', {
              type: 'initial',
              filename,
              lines: initialLines.map(line => this.parseLogLine(line))
            });
          });

          // Watch for file changes
          const watcher = fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
            if (curr.mtime > prev.mtime) {
              this.tailFile(filePath, 10).then(newLines => {
                socket.emit('log-data', {
                  type: 'update',
                  filename,
                  lines: newLines.map(line => this.parseLogLine(line))
                });
              });
            }
          });

          socket.on('stop-tail', () => {
            fs.unwatchFile(filePath);
          });

          socket.on('disconnect', () => {
            fs.unwatchFile(filePath);
          });

        } catch (error) {
          socket.emit('log-error', { message: error.message });
        }
      });

      // Handle log level filtering in real-time
      socket.on('filter-logs', (data) => {
        const { filename, level } = data;
        // Implementation for real-time filtering
      });
    });
  }
}

module.exports = LogsRoutes;