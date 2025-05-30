// mockTcpServer.js
const net = require('net');
const winston = require('winston');

// --- Configure Winston logger for the mock server ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [MOCK TCP SERVER] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp }) => {
              return `${timestamp} [MOCK TCP SERVER] ${level}: ${message}`;
            })
        )
    }),
    // Optionally add a file transport for mock server logs
  ],
});

const MOCK_TCP_HOST = process.env.MOCK_TCP_HOST || '0.0.0.0'; // Listen on all interfaces
const MOCK_TCP_PORT = process.env.MOCK_TCP_PORT || 10003; // Default secondary TCP port

// Timeout settings
const NO_COMMAND_TIMEOUT = 15000; // 15 seconds
const CONNECTION_TIMEOUT = 30000; // 30 seconds max per connection
const RESPONSE_DELAY = 100; // Simulate processing delay
const CLOSE_DELAY = 500; // Delay before closing connection after response

class MockTcpServer {
  constructor() {
    this.server = null;
    this.activeConnections = new Set();
    this.commandTimeouts = new Map();
    this.connectionTimeouts = new Map();
  }

  start() {
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.on('error', (err) => {
      logger.error(`Mock TCP Server error: ${err.message}`);
      process.exit(1);
    });

    this.server.listen(MOCK_TCP_PORT, MOCK_TCP_HOST, () => {
      logger.info(`Mock TCP Server listening on ${MOCK_TCP_HOST}:${MOCK_TCP_PORT}`);
      logger.info('Ready to receive connections and "200" commands...');
    });
  }

  handleConnection(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info(`New connection from ${clientId}`);
    
    this.activeConnections.add(socket);
    
    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
      logger.warn(`Connection timeout for ${clientId}. Closing connection.`);
      this.cleanupConnection(socket);
    }, CONNECTION_TIMEOUT);
    
    this.connectionTimeouts.set(socket, connectionTimeout);

    // Set no-command timeout
    const noCommandTimeout = setTimeout(() => {
      logger.warn(`No command received from ${clientId} within ${NO_COMMAND_TIMEOUT / 1000} seconds. Closing connection.`);
      this.cleanupConnection(socket);
    }, NO_COMMAND_TIMEOUT);
    
    this.commandTimeouts.set(socket, noCommandTimeout);

    // Handle incoming data
    socket.on('data', (data) => {
      // Clear the no-command timeout since we received data
      const noCommandTimer = this.commandTimeouts.get(socket);
      if (noCommandTimer) {
        clearTimeout(noCommandTimer);
        this.commandTimeouts.delete(socket);
      }

      const receivedData = data.toString().trim();
      logger.info(`Received data from ${clientId}: "${receivedData}"`);

      // Check if the received data contains any of the supported commands
      if (receivedData.includes('200')) {
        logger.info(`Found command '200' in received data`);
        this.handleCommand200(socket, clientId);
      } else if (receivedData.includes('I20100')) {
        logger.info(`Found command 'I20100' in received data`);
        this.handleCommandI20100(socket, clientId);
      } else if (receivedData.includes('I20200')) {
        logger.info(`Found command 'I20200' in received data`);
        this.handleCommandI20200(socket, clientId);
      } else if (receivedData.includes('I37300')) {
        logger.info(`Found command 'I37300' in received data`);
        this.handleCommandI37300(socket, clientId);
      } else if (receivedData.includes('I30100')) {
        logger.info(`Found command 'I30100' in received data`);
        this.handleCommandI30100(socket, clientId);
      } else if (receivedData.includes('I20700')) {
        logger.info(`Found command 'I20700' in received data`);
        this.handleCommandI20700(socket, clientId);
      } else {
        logger.warn(`Received unknown command from ${clientId}: "${receivedData}". Not responding.`);
        // Set a new timeout for the next command
        const newTimeout = setTimeout(() => {
          logger.warn(`No valid command received from ${clientId}. Closing connection.`);
          this.cleanupConnection(socket);
        }, NO_COMMAND_TIMEOUT);
        this.commandTimeouts.set(socket, newTimeout);
      }
    });

    // Handle connection close
    socket.on('close', (hadError) => {
      logger.info(`Connection from ${clientId} closed${hadError ? ' with error' : ' gracefully'}`);
      this.cleanupConnection(socket);
    });

    // Handle connection errors
    socket.on('error', (err) => {
      logger.error(`Connection error from ${clientId}: ${err.message}`);
      this.cleanupConnection(socket);
    });
  }

  handleCommand200(socket, clientId) {
    logger.info(`Recognized "200" command from ${clientId}. Preparing response...`);

    // Format the current date and time
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // The hour '0' should be '12'

    const dateLine = `${month} ${day}, ${year}  ${hours}:${minutes} ${ampm}`;

    const responseData = `
    200 
    FUEL EXPRESSO ZIPZ
    12671 ANTIOCH RD
    O.P. KS. 66213

    ${dateLine}

    TANK  PRODUCT               GALLONS  INCHES   WATER  DEG F   ULLAGE

    1   UNLEADED                 7598   56.71     0.0   64.3     3997
    2   PREMIUM                  1976   23.73     0.0   62.3     7720
`;

    this.sendResponse(socket, clientId, responseData, true);
  }

  /**
   * Handle I20100 command - Get tank inventory data
   */
  handleCommandI20100(socket, clientId) {
    logger.info(`Recognized "I20100" command from ${clientId}. Preparing tank inventory response...`);

    const responseData = `I20100
1,REGULAR,7598.2,3997.8,56.71,0.00,64.3,11596.0,0,0,0,0,0
2,PREMIUM,1976.5,7720.5,23.73,0.00,62.3,9697.0,0,0,0,0,0
`;

    this.sendResponse(socket, clientId, responseData);
  }

  /**
   * Handle I20200 command - Get delivery data
   */
  handleCommandI20200(socket, clientId) {
    logger.info(`Recognized "I20200" command from ${clientId}. Preparing delivery data response...`);

    const responseData = `I20200
1,05/28/2025,08:15,REGULAR,1500.0,5500.0,7000.0
2,05/27/2025,14:30,PREMIUM,800.0,1200.0,2000.0
`;

    this.sendResponse(socket, clientId, responseData);
  }

  /**
   * Handle I37300 command - Get alarm status
   */
  handleCommandI37300(socket, clientId) {
    logger.info(`Recognized "I37300" command from ${clientId}. Preparing alarm status response...`);

    const responseData = `I37300
NO ACTIVE ALARMS
`;

    this.sendResponse(socket, clientId, responseData);
  }

  /**
   * Handle I30100 command - Get system status
   */
  handleCommandI30100(socket, clientId) {
    logger.info(`Recognized "I30100" command from ${clientId}. Preparing system status response...`);

    const responseData = `I30100
SYSTEM NORMAL
FIRMWARE: v2.5.1
UPTIME: 15 DAYS
`;

    this.sendResponse(socket, clientId, responseData);
  }

  /**
   * Handle I20700 command - Get tank leak test results
   */
  handleCommandI20700(socket, clientId) {
    logger.info(`Recognized "I20700" command from ${clientId}. Preparing leak test results...`);

    const responseData = `I20700
1,05/28/2025,PASS,0.05,24.0
2,05/28/2025,PASS,0.02,24.0
`;

    this.sendResponse(socket, clientId, responseData);
  }

  /**
   * Send response to client with proper delay and connection handling
   */
  sendResponse(socket, clientId, responseData) {
    // Simulate sending data from the mock device to the client after a small delay
    setTimeout(() => {
      if (socket.destroyed) {
        logger.warn(`Socket for ${clientId} was destroyed before response could be sent`);
        return;
      }

      logger.info(`Sending response to ${clientId} (total ${responseData.length} bytes)`);
      
      socket.write(responseData, (err) => {
        if (err) {
          logger.error(`Error sending response to ${clientId}: ${err.message}`);
          this.cleanupConnection(socket);
          return;
        }

        logger.info(`Response sent successfully to ${clientId}`);
        
        // Set a new timeout for the next command
        const newTimeout = setTimeout(() => {
          logger.warn(`No follow-up command received from ${clientId}. Closing connection.`);
          this.cleanupConnection(socket);
        }, NO_COMMAND_TIMEOUT);
        this.commandTimeouts.set(socket, newTimeout);
      });
    }, RESPONSE_DELAY);
  }

  cleanupConnection(socket) {
    if (socket.destroyed) {
      return;
    }

    // Clear timeouts
    const commandTimeout = this.commandTimeouts.get(socket);
    if (commandTimeout) {
      clearTimeout(commandTimeout);
      this.commandTimeouts.delete(socket);
    }

    const connectionTimeout = this.connectionTimeouts.get(socket);
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      this.connectionTimeouts.delete(socket);
    }

    // Remove from active connections
    this.activeConnections.delete(socket);

    // Close socket if not already closed
    if (!socket.destroyed) {
      socket.end();
    }
  }

  stop() {
    logger.info('Shutting down Mock TCP Server...');
    
    // Close all active connections
    this.activeConnections.forEach(socket => {
      this.cleanupConnection(socket);
    });

    // Clear all timeouts
    this.commandTimeouts.forEach(timeout => clearTimeout(timeout));
    this.connectionTimeouts.forEach(timeout => clearTimeout(timeout));
    
    this.commandTimeouts.clear();
    this.connectionTimeouts.clear();

    // Close the server
    if (this.server) {
      this.server.close(() => {
        logger.info('Mock TCP Server shut down gracefully');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  getStatus() {
    return {
      listening: this.server ? this.server.listening : false,
      address: this.server ? this.server.address() : null,
      activeConnections: this.activeConnections.size,
      pendingTimeouts: this.commandTimeouts.size
    };
  }
}

// Create and start the mock server
const mockServer = new MockTcpServer();

// Start the server
mockServer.start();

// Handle process termination
process.on('SIGINT', () => {
logger.info('Received SIGINT signal. Shutting down mock TCP server...');
mockServer.stop();
});

process.on('SIGTERM', () => {
logger.info('Received SIGTERM signal. Shutting down mock TCP server...');
mockServer.stop();
});

logger.info('Mock TCP Server process started');

// Log available commands
logger.info('Available commands:');
logger.info('- 200: Get tank inventory in human-readable format');
logger.info('- I20100: Get tank inventory data in machine format');
logger.info('- I20200: Get delivery data');
logger.info('- I37300: Get alarm status');
logger.info('- I30100: Get system status');
logger.info('- I20700: Get tank leak test results');

// If this script is run directly (not imported as a module)
if (require.main === module) {
logger.info(`Starting mock TCP server on ${MOCK_TCP_HOST}:${MOCK_TCP_PORT}`);
// Server is already started above
}

process.on('uncaughtException', (err) => {
logger.error(`Uncaught exception: ${err.message}`);
logger.error(err.stack);
mockServer.stop();
});

process.on('unhandledRejection', (reason, promise) => {
logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
mockServer.stop();
});

// Export for potential use as a module
module.exports = MockTcpServer;