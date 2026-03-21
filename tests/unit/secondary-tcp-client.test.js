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

const SecondaryTcpClient = require('../../src/services/secondary-tcp-client');

function createTestServer() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function makeConfig(port, overrides = {}) {
  return {
    secondaryTcpIp: '127.0.0.1',
    secondaryTcpPort: port,
    connectionTimeout: 2000,
    maxRetries: 1,
    retryDelay: 100,
    heartbeatInterval: 60000, // long interval so it doesn't fire during tests
    ...overrides,
  };
}

describe('SecondaryTcpClient', () => {
  let server;
  let port;
  let client;
  let serverSockets;

  beforeEach(async () => {
    serverSockets = [];
    ({ server, port } = await createTestServer());
    server.on('connection', (sock) => serverSockets.push(sock));
  });

  afterEach(() => {
    // Force-cleanup client to avoid internal close() timeout (5s)
    if (client) {
      client.removeAllListeners();
      client.cleanup();
      client = null;
    }
    // Destroy server-side sockets so server.close() doesn't hang
    for (const sock of serverSockets) {
      try { sock.destroy(); } catch {}
    }
    serverSockets = [];
    try { server.close(); } catch {}
  });

  test('connects successfully and emits connected event', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    const connected = new Promise((r) => client.once('connected', r));

    await client.connect();

    const info = await connected;
    expect(client.isConnected).toBe(true);
    expect(client.socket).not.toBeNull();
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBe(port);
  });

  test('cleans up socket on close (socket === null, isConnected === false, heartbeat stopped)', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(client.heartbeatInterval).not.toBeNull();

    await client.close();

    expect(client.socket).toBeNull();
    expect(client.isConnected).toBe(false);
    expect(client.heartbeatInterval).toBeNull();
  });

  test('sends data through open connection', async () => {
    const received = new Promise((resolve) => {
      server.once('connection', (sock) => {
        sock.once('data', (data) => resolve(data));
      });
    });

    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();

    const payload = Buffer.from('secondary-data');
    await client.send(payload);

    const data = await received;
    expect(data.toString()).toBe('secondary-data');
  });

  test('detects invalid socket state and attempts reconnection before send', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();

    // Destroy socket to make it invalid
    client.socket.destroy();

    // Set up data listener for the NEXT connection (reconnect will create a new one)
    const received = new Promise((resolve) => {
      server.on('connection', (sock) => {
        sock.on('data', (data) => resolve(data));
      });
    });

    // send() detects destroyed socket → reconnects → sends
    await client.send(Buffer.from('after-reconnect'));

    const data = await received;
    expect(data.toString()).toBe('after-reconnect');
    expect(client.isConnected).toBe(true);
  }, 15000);

  test('heartbeat detects destroyed socket and triggers disconnection', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();

    const disconnected = new Promise((r) => client.once('disconnected', r));

    // Destroy socket behind the client's back
    client.socket.destroy();

    // Manually trigger heartbeat check
    client.checkConnection();

    const info = await disconnected;
    expect(client.isConnected).toBe(false);
    expect(client.socket).toBeNull();
    expect(info.wasConnected).toBe(true);
  });

  test('reconnect cleans up old connection before creating new one', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();

    const oldSocket = client.socket;

    await client.reconnect();

    // Old socket should be destroyed, new one created
    expect(oldSocket.destroyed).toBe(true);
    expect(client.socket).not.toBeNull();
    expect(client.socket).not.toBe(oldSocket);
    expect(client.isConnected).toBe(true);
  });

  test('close stops heartbeat and destroys socket', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();

    const socketRef = client.socket;
    expect(client.heartbeatInterval).not.toBeNull();

    await client.close();

    expect(client.heartbeatInterval).toBeNull();
    expect(client.socket).toBeNull();
    expect(socketRef.destroyed).toBe(true);
  });

  test('close on already-closed connection is safe (idempotent)', async () => {
    client = new SecondaryTcpClient(makeConfig(port));
    await client.connect();

    await client.close();
    // second close should not throw
    await client.close();

    expect(client.socket).toBeNull();
    expect(client.isConnected).toBe(false);
  });
});
