const net = require('net');

// Mock logger and dataLogger before requiring the module
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

const TcpClient = require('../../src/services/tcp-client');

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
    tcpIp: '127.0.0.1',
    tcpPort: port,
    connectionTimeout: 2000,
    maxRetries: 1,
    retryDelay: 100,
    ...overrides,
  };
}

describe('TcpClient', () => {
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
    if (client) {
      client.removeAllListeners();
      client.cleanup();
      client = null;
    }
    for (const sock of serverSockets) {
      try { sock.destroy(); } catch {}
    }
    serverSockets = [];
    try { server.close(); } catch {}
  });

  test('connects successfully and emits connected event', async () => {
    client = new TcpClient(makeConfig(port));
    const connected = new Promise((r) => client.once('connected', r));

    await client.connect();

    const info = await connected;
    expect(client.isConnected).toBe(true);
    expect(client.socket).not.toBeNull();
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBe(port);
  });

  test('cleans up socket on close (socket === null, isConnected === false)', async () => {
    client = new TcpClient(makeConfig(port));
    await client.connect();
    expect(client.isConnected).toBe(true);

    await client.close();

    expect(client.socket).toBeNull();
    expect(client.isConnected).toBe(false);
  });

  test('sends data through open connection', async () => {
    const received = new Promise((resolve) => {
      server.once('connection', (sock) => {
        sock.once('data', (data) => resolve(data));
      });
    });

    client = new TcpClient(makeConfig(port));
    await client.connect();

    const payload = Buffer.from('hello');
    await client.send(payload);

    const data = await received;
    expect(data.toString()).toBe('hello');
  });

  test('rejects send when not connected', async () => {
    client = new TcpClient(makeConfig(port));
    // don't connect

    await expect(client.send(Buffer.from('test'))).rejects.toThrow('TCP client not connected');
  });

  test('handles connection refused (ECONNREFUSED)', async () => {
    // close server so connection is refused
    await new Promise((r) => server.close(r));

    client = new TcpClient(makeConfig(port));
    client.on('error', () => {}); // prevent unhandled error

    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected).toBe(false);
    expect(client.socket).toBeNull();
  });

  test('handles connection timeout', async () => {
    // Use a non-routable IP to trigger timeout
    client = new TcpClient(makeConfig(port, {
      tcpIp: '192.0.2.1', // TEST-NET, should not respond
      connectionTimeout: 500,
      maxRetries: 1,
      retryDelay: 50,
    }));
    client.on('error', () => {});

    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected).toBe(false);
  }, 10000);

  test('graceful close releases socket resources', async () => {
    client = new TcpClient(makeConfig(port));
    await client.connect();

    const socketBefore = client.socket;
    expect(socketBefore).not.toBeNull();

    await client.close();

    expect(client.socket).toBeNull();
    expect(client.isConnected).toBe(false);
    expect(socketBefore.destroyed).toBe(true);
  });

  test('close on already-closed connection is safe (idempotent)', async () => {
    client = new TcpClient(makeConfig(port));
    await client.connect();

    await client.close();
    // Second close should not throw
    await client.close();

    expect(client.socket).toBeNull();
    expect(client.isConnected).toBe(false);
  });
});
