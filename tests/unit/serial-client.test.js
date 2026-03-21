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

// Mock serialport before requiring SerialClient
jest.mock('serialport', () => {
  const EventEmitter = require('events');

  class MockSerialPort extends EventEmitter {
    constructor(options) {
      super();
      this.path = options.path;
      this.baudRate = options.baudRate;
      this.isOpen = false;
      this._destroyed = false;
    }

    open(callback) {
      // Simulate async open
      process.nextTick(() => {
        this.isOpen = true;
        if (callback) callback(null);
        this.emit('open');
      });
    }

    write(data, callback) {
      if (!this.isOpen) {
        const err = new Error('Port is not open');
        if (callback) return callback(err);
        throw err;
      }
      process.nextTick(() => {
        if (callback) callback(null);
      });
    }

    close(callback) {
      process.nextTick(() => {
        this.isOpen = false;
        if (callback) callback(null);
        this.emit('close', false);
      });
    }

    removeAllListeners() {
      super.removeAllListeners();
      return this;
    }
  }

  return {
    SerialPort: MockSerialPort,
  };
});

const SerialClient = require('../../src/services/serial-client');

function makeConfig(overrides = {}) {
  return {
    serialPath: '/dev/ttyUSB0',
    serialBaud: 9600,
    serialParity: 'none',
    serialDataBits: 8,
    serialStopBits: 1,
    maxRetries: 1,
    retryDelay: 100,
    ...overrides,
  };
}

describe('SerialClient', () => {
  let client;

  afterEach(async () => {
    if (client) {
      client.removeAllListeners();
      try { await client.close(); } catch {}
      client = null;
    }
  });

  test('connects successfully and emits connected event', async () => {
    client = new SerialClient(makeConfig());
    const connected = new Promise((r) => client.once('connected', r));

    await client.connect();

    const info = await connected;
    expect(client.isConnected).toBe(true);
    expect(client.port).not.toBeNull();
    expect(info.path).toBe('/dev/ttyUSB0');
    expect(info.baudRate).toBe(9600);
  });

  test('cleans up port on close (port === null, isConnected === false)', async () => {
    client = new SerialClient(makeConfig());
    await client.connect();
    expect(client.isConnected).toBe(true);

    await client.close();

    expect(client.port).toBeNull();
    expect(client.isConnected).toBe(false);
  });

  test('sends data through open port', async () => {
    client = new SerialClient(makeConfig());
    await client.connect();

    // send should resolve without error
    await client.send(Buffer.from('serial-data'));

    expect(client.totalBytesSent).toBe(11);
  });

  test('rejects send when port not open', async () => {
    client = new SerialClient(makeConfig());
    // don't connect

    await expect(client.send(Buffer.from('test'))).rejects.toThrow(
      'Serial port not connected or not open'
    );
  });

  test('graceful close releases port resources', async () => {
    client = new SerialClient(makeConfig());
    await client.connect();
    expect(client.port).not.toBeNull();

    await client.close();

    expect(client.port).toBeNull();
    expect(client.isConnected).toBe(false);
    expect(client.isClosing).toBe(true);
  });

  test('close on already-closed port is safe (idempotent)', async () => {
    client = new SerialClient(makeConfig());
    await client.connect();

    await client.close();
    // second close should not throw
    await client.close();

    expect(client.port).toBeNull();
    expect(client.isConnected).toBe(false);
  });
});
