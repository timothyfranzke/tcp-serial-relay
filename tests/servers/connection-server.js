const net = require('net');
const winston = require('winston');

// Configuration
const PORT = process.env.MAIN_TCP_PORT || 9001;
const HOST = process.env.MAIN_TCP_HOST || '0.0.0.0';
const COMMAND_DELAY = process.env.COMMAND_DELAY || 1000; // Delay before sending command
const AUTO_COMMAND_INTERVAL = process.env.AUTO_COMMAND_INTERVAL || 0; // 0 = disabled, otherwise interval in ms

// --- Configure Winston logger ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [MAIN TCP SERVER] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp }) => {
              return `${timestamp} [MAIN TCP SERVER] ${level}: ${message}`;
            })
        )
    }),
  ],
});

class MainTcpServer {
  constructor() {
    this.server = null;
    this.activeConnections = new Map();
    this.connectionCount = 0;
    this.autoCommandIntervals = new Map();
  }

  start() {
    // Create a TCP server for data ingestion
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    // Handle server errors
    this.server.on('error', (err) => {
      logger.error(`Server error: ${err.message}`);
      process.exit(1);
    });

    // Start the server
    this.server.listen(PORT, HOST, () => {
      logger.info(`Main TCP Server running on ${HOST}:${PORT}`);
      logger.info('Waiting for relay connections...');
      
      if (AUTO_COMMAND_INTERVAL > 0) {
        logger.info(`Auto-command enabled: will send ASCII Ctrl+A + "200" every ${AUTO_COMMAND_INTERVAL}ms when clients connect`);
      } else {
        logger.info('Auto-command disabled: will send ASCII Ctrl+A + "200" once on connection and when data is received');
      }
    });
  }

  handleConnection(socket) {
    this.connectionCount++;
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    const connectionId = `conn-${this.connectionCount}`;
    
    logger.info(`Client connected: ${clientId} (ID: ${connectionId})`);
    
    // Store connection info
    const connectionInfo = {
      id: connectionId,
      clientId: clientId,
      socket: socket,
      connected: true,
      dataReceived: 0,
      commandsSent: 0,
      lastActivity: new Date(),
      aggregatedData: Buffer.alloc(0),
      aggregationTimeout: null
    };
    
    this.activeConnections.set(socket, connectionInfo);

    // Send initial ASCII Ctrl+A + "200" command after a brief delay
    setTimeout(() => {
      if (!socket.destroyed && socket.writable) {
        this.sendAsciiCommand(socket, 'initial connection');
      }
    }, COMMAND_DELAY);

    // Set up auto-command interval if enabled
    if (AUTO_COMMAND_INTERVAL > 0) {
      const intervalId = setInterval(() => {
        if (!socket.destroyed && socket.writable) {
          this.sendAsciiCommand(socket, 'auto-interval');
        } else {
          clearInterval(intervalId);
          this.autoCommandIntervals.delete(socket);
        }
      }, AUTO_COMMAND_INTERVAL);
      
      this.autoCommandIntervals.set(socket, intervalId);
    }

    // Handle data from client (relay)
    socket.on('data', (data) => {
      this.handleIncomingData(socket, data);
    });

    // Handle client disconnection
    socket.on('end', () => {
      logger.info(`Client ${clientId} disconnected gracefully`);
      this.cleanupConnection(socket);
    });

    // Handle connection close
    socket.on('close', (hadError) => {
      logger.info(`Connection ${clientId} closed${hadError ? ' with error' : ' normally'}`);
      this.cleanupConnection(socket);
    });

    // Handle errors
    socket.on('error', (err) => {
      logger.error(`Socket error for ${clientId}: ${err.message}`);
      this.cleanupConnection(socket);
    });
  }

  handleIncomingData(socket, data) {
    const connectionInfo = this.activeConnections.get(socket);
    if (!connectionInfo) return;

    connectionInfo.dataReceived++;
    connectionInfo.lastActivity = new Date();

    // Append new data to the aggregated buffer
    connectionInfo.aggregatedData = Buffer.concat([connectionInfo.aggregatedData, data]);

    // Just log that we received data, but don't show the content yet
    logger.info(`Received ${data.length} bytes from ${connectionInfo.clientId} (total aggregated: ${connectionInfo.aggregatedData.length} bytes)`);

    // Reset the aggregation timeout
    if (connectionInfo.aggregationTimeout) {
      clearTimeout(connectionInfo.aggregationTimeout);
    }

    // Set a timeout to output final result if no more data comes in
    connectionInfo.aggregationTimeout = setTimeout(() => {
      this.outputFinalResult(connectionInfo, 'timeout');
    }, 3000); // 3 second timeout

    // Send another ASCII Ctrl+A + "200" command after receiving data (simulating ongoing requests)
    setTimeout(() => {
      if (!socket.destroyed && socket.writable && AUTO_COMMAND_INTERVAL === 0) {
        this.sendAsciiCommand(socket, 'response to data');
      }
    }, COMMAND_DELAY);
  }

  outputFinalResult(connectionInfo, reason) {
    if (!connectionInfo.aggregatedData || connectionInfo.aggregatedData.length === 0) {
      logger.info(`No data to output for ${connectionInfo.clientId}`);
      return;
    }

    const dataStr = connectionInfo.aggregatedData.toString();
    const dataHex = connectionInfo.aggregatedData.toString('hex');
    
    logger.info(`=== FINAL AGGREGATED RESULT (${reason}) ===`);
    logger.info(`Connection: ${connectionInfo.clientId}`);
    logger.info(`Total bytes received: ${connectionInfo.aggregatedData.length}`);
    logger.info(`Commands sent: ${connectionInfo.commandsSent}`);
    logger.info(`HEX: ${dataHex}`);
    
    // Log the response in a readable format
    if (dataStr.includes('FUEL EXPRESSO') || dataStr.includes('UNLEADED') || dataStr.includes('PREMIUM')) {
      logger.info('Final fuel data response:');
      console.log('=====================================');
      console.log(dataStr);
      console.log('=====================================');
    } else {
      logger.info('Final data content:');
      console.log('=====================================');
      console.log(`"${dataStr.trim()}"`);
      console.log('=====================================');
    }
    
    // Clear the aggregated data to prevent duplicate output
    connectionInfo.aggregatedData = Buffer.alloc(0);
    
    // Clear the timeout
    if (connectionInfo.aggregationTimeout) {
      clearTimeout(connectionInfo.aggregationTimeout);
      connectionInfo.aggregationTimeout = null;
    }
  }

  sendAsciiCommand(socket, reason) {
    const connectionInfo = this.activeConnections.get(socket);
    if (!connectionInfo) return;

    try {
      // Create ASCII command: Ctrl+A (0x01) + "200"
      const ctrlA = String.fromCharCode(0x01);  // ASCII Control-A character
      const command = ctrlA + '200';
      const commandBuffer = Buffer.from(command, 'ascii');
      
      socket.write(commandBuffer);
      connectionInfo.commandsSent++;
      connectionInfo.lastActivity = new Date();
      
      // Log with hex representation for clarity
      const commandHex = commandBuffer.toString('hex');
      logger.info(`Sent ASCII Ctrl+A + "200" to ${connectionInfo.clientId} (reason: ${reason}, total sent: ${connectionInfo.commandsSent})`);
      logger.info(`Command as HEX: ${commandHex}`);
    } catch (error) {
      logger.error(`Failed to send command to ${connectionInfo.clientId}: ${error.message}`);
    }
  }

  // Legacy method for backward compatibility - now sends ASCII too
  sendCommand(socket, command, reason) {
    // If the old string format is used, convert it to ASCII
    if (command === 'cntl+a 200') {
      this.sendAsciiCommand(socket, reason);
      return;
    }
    
    // For any other commands, send as-is
    const connectionInfo = this.activeConnections.get(socket);
    if (!connectionInfo) return;

    try {
      socket.write(command);
      connectionInfo.commandsSent++;
      connectionInfo.lastActivity = new Date();
      
      logger.info(`Sent "${command}" to ${connectionInfo.clientId} (reason: ${reason}, total sent: ${connectionInfo.commandsSent})`);
    } catch (error) {
      logger.error(`Failed to send command to ${connectionInfo.clientId}: ${error.message}`);
    }
  }

  cleanupConnection(socket) {
    const connectionInfo = this.activeConnections.get(socket);
    if (connectionInfo) {
      // Output final result before cleanup
      this.outputFinalResult(connectionInfo, 'connection closed');
      
      logger.info(`Cleaning up connection ${connectionInfo.clientId} - Commands sent: ${connectionInfo.commandsSent}, Data packets received: ${connectionInfo.dataReceived}`);
      
      // Clear aggregation timeout if it exists
      if (connectionInfo.aggregationTimeout) {
        clearTimeout(connectionInfo.aggregationTimeout);
      }
    }

    // Clear auto-command interval
    const intervalId = this.autoCommandIntervals.get(socket);
    if (intervalId) {
      clearInterval(intervalId);
      this.autoCommandIntervals.delete(socket);
    }

    // Remove from active connections
    this.activeConnections.delete(socket);

    // Close socket if not already closed
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  getStatus() {
    const connections = Array.from(this.activeConnections.values()).map(conn => ({
      id: conn.id,
      clientId: conn.clientId,
      commandsSent: conn.commandsSent,
      dataReceived: conn.dataReceived,
      lastActivity: conn.lastActivity
    }));

    return {
      listening: this.server ? this.server.listening : false,
      address: this.server ? this.server.address() : null,
      activeConnections: this.activeConnections.size,
      totalConnections: this.connectionCount,
      connections: connections
    };
  }

  stop() {
    logger.info('Shutting down Main TCP Server...');
    
    // Clear all intervals
    this.autoCommandIntervals.forEach(intervalId => clearInterval(intervalId));
    this.autoCommandIntervals.clear();

    // Close all active connections
    this.activeConnections.forEach((connectionInfo, socket) => {
      this.cleanupConnection(socket);
    });

    // Close the server
    if (this.server) {
      this.server.close(() => {
        logger.info('Main TCP Server shut down gracefully');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
}

// Create and start the server
const mainServer = new MainTcpServer();

// Start the server
mainServer.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down Main TCP Server...');
  mainServer.stop();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down Main TCP Server...');
  mainServer.stop();
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack);
  mainServer.stop();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  mainServer.stop();
});

// Status reporting (optional)
if (process.argv.includes('--status')) {
  setInterval(() => {
    const status = mainServer.getStatus();
    logger.info(`Status: ${status.activeConnections} active connections, ${status.totalConnections} total connections`);
  }, 30000);
}

// Export for potential use as a module
module.exports = MainTcpServer;