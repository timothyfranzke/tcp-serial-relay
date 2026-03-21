const net = require('net');

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  dataLogger: {
    info: jest.fn(),
    silly: jest.fn(),
  },
}));

jest.mock('../../src/utils/status-manager', () => ({
  updateStatus: jest.fn(),
  updateConnection: jest.fn(),
  incrementMetric: jest.fn(),
  registerConnection: jest.fn(),
}));

jest.mock('../../src/utils/device-info', () => ({
  getDeviceId: jest.fn(() => 'test-device-id'),
  getDeviceInfo: jest.fn(() => ({ id: 'test' })),
}));

const RelayService = require('../../src/services/relay-service');

function createTestServer() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

const tick = () => new Promise((r) => setImmediate(r));

describe('RelayService', () => {
  let primaryServer;
  let secondaryServer;
  let primaryPort;
  let secondaryPort;
  let relay;
  let serverSockets; // track server-side sockets for cleanup

  beforeEach(async () => {
    serverSockets = [];
    ({ server: primaryServer, port: primaryPort } = await createTestServer());
    ({ server: secondaryServer, port: secondaryPort } = await createTestServer());
    // Collect server-side sockets so we can destroy them in afterEach
    primaryServer.on('connection', (sock) => serverSockets.push(sock));
    secondaryServer.on('connection', (sock) => serverSockets.push(sock));
  });

  afterEach(() => {
    // 1. Force-cleanup relay internals (avoids 3-5s graceful-close timeouts)
    if (relay) {
      if (relay.relayTimeout) {
        clearTimeout(relay.relayTimeout);
        relay.relayTimeout = null;
      }
      if (relay.tcpClient) {
        relay.tcpClient.removeAllListeners();
        relay.tcpClient.cleanup();
      }
      if (relay.secondaryClient) {
        relay.secondaryClient.removeAllListeners();
        relay.secondaryClient.cleanup();
      }
      relay.removeAllListeners();
      relay.isRunning = false;
      relay = null;
    }
    // 2. Destroy all server-side sockets so server.close() won't hang
    for (const sock of serverSockets) {
      try { sock.destroy(); } catch {}
    }
    serverSockets = [];
    // 3. Close servers (synchronous initiation — no await needed)
    try { primaryServer.close(); } catch {}
    try { secondaryServer.close(); } catch {}
  });

  function makeConfig() {
    return {
      connectionType: 'tcp',
      tcpIp: '127.0.0.1',
      tcpPort: primaryPort,
      secondaryTcpIp: '127.0.0.1',
      secondaryTcpPort: secondaryPort,
      connectionTimeout: 2000,
      maxRetries: 1,
      retryDelay: 100,
      relayTimeout: 60000,
      heartbeatInterval: 60000,
    };
  }

  test('connectClients() connects secondary BEFORE tcp (order matters)', async () => {
    const connectOrder = [];
    // Add order-tracking listeners (on top of the socket-collection listener from beforeEach)
    secondaryServer.on('connection', () => connectOrder.push('secondary'));
    primaryServer.on('connection', () => connectOrder.push('primary'));

    relay = new RelayService(makeConfig());
    await relay.start();
    // Let pending I/O events (server-side 'connection') flush
    await tick();

    expect(connectOrder).toEqual(['secondary', 'primary']);
  });

  test('stop() closes both connections', async () => {
    relay = new RelayService(makeConfig());
    await relay.start();

    expect(relay.tcpClient.isConnected).toBe(true);
    expect(relay.secondaryClient.isConnected).toBe(true);

    await relay.stop();

    expect(relay.tcpClient.isConnected).toBe(false);
    expect(relay.secondaryClient.isConnected).toBe(false);
    expect(relay.tcpClient.socket).toBeNull();
    expect(relay.secondaryClient.socket).toBeNull();
  }, 15000);

  test('stop() completes without crash and emits stopped event', async () => {
    relay = new RelayService(makeConfig());
    await relay.start();

    // Collect ALL stopped events — close() triggers handleDisconnection (no stats),
    // then stop() itself emits stopped (with stats).
    const stoppedEvents = [];
    relay.on('stopped', (info) => stoppedEvents.push(info));

    await relay.stop();

    expect(relay.isRunning).toBe(false);
    expect(stoppedEvents.length).toBeGreaterThanOrEqual(1);
    const lastEvent = stoppedEvents[stoppedEvents.length - 1];
    expect(lastEvent).toHaveProperty('success');
    expect(lastEvent).toHaveProperty('stats');
  }, 15000);

  test('handleDisconnection emits correct events', async () => {
    relay = new RelayService(makeConfig());
    await relay.start();

    const clientDisconnected = new Promise((r) => relay.once('clientDisconnected', r));

    // Simulate TCP disconnection
    relay.tcpClient.socket.destroy();

    const info = await clientDisconnected;
    expect(info.clientType).toBe('tcp');
    expect(info.clientName).toBe('TCP');
  });

  test('data relay from TCP triggers send on secondary', async () => {
    // Capture data arriving at the secondary server
    const secondaryGotData = new Promise((resolve) => {
      secondaryServer.on('connection', (sock) => {
        sock.on('data', resolve);
      });
    });

    relay = new RelayService(makeConfig());
    await relay.start();

    const testData = Buffer.from('tcp-to-secondary');
    await relay.handleDataFromTcp(testData, {
      source: 'tcp',
      bytes: testData.length,
      hex: testData.toString('hex'),
    });

    const received = await secondaryGotData;
    expect(received.toString()).toContain('tcp-to-secondary');
  });

  test('data relay from secondary triggers send on TCP', async () => {
    let primaryReceivedData = Buffer.alloc(0);
    const primaryGotRelayedData = new Promise((resolve) => {
      primaryServer.on('connection', (sock) => {
        sock.on('data', (data) => {
          primaryReceivedData = Buffer.concat([primaryReceivedData, data]);
          if (primaryReceivedData.toString().includes('secondary-to-tcp')) {
            resolve();
          }
        });
      });
    });

    relay = new RelayService(makeConfig());
    await relay.start();

    const testData = Buffer.from('secondary-to-tcp');
    await relay.handleDataFromSecondary(testData, {
      source: 'secondary-tcp',
      bytes: testData.length,
      hex: testData.toString('hex'),
    });

    await primaryGotRelayedData;
    expect(primaryReceivedData.toString()).toContain('secondary-to-tcp');
  });
});
