// ── Module-level mocks ──────────────────────────────────────────────────────

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/config', () => ({
  loadConfig: jest.fn(),
  updateConfig: jest.fn(),
}));

jest.mock('../../src/utils/status-manager', () => ({
  shutdown: jest.fn(),
  updateStatus: jest.fn(),
  onShutdown: jest.fn(),
  getStatus: jest.fn(),
  setConfig: jest.fn(),
  setUpdateConfigFunc: jest.fn(),
}));

jest.mock('../../src/utils/device-info', () => ({
  getDeviceInfo: jest.fn(() => ({ id: 'test' })),
}));

jest.mock('../../src/services/relay-service', () => {
  const { EventEmitter } = require('events');
  return jest.fn(() => {
    const emitter = new EventEmitter();
    emitter.start = jest.fn().mockResolvedValue();
    emitter.stop = jest.fn().mockResolvedValue();
    emitter.getHealthStatus = jest.fn(() => null);
    return emitter;
  });
});

// ── Requires (after mocks) ─────────────────────────────────────────────────

const fs = require('fs');
const { execSync } = require('child_process');
const { TcpSerialRelayApp } = require('../../src/app');

const FAILURE_STATE_FILE = '/tmp/tcp-serial-relay-secondary-failures';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    connectionType: 'tcp',
    tcpIp: '10.0.0.1',
    tcpPort: 502,
    secondaryTcpIp: '192.168.1.100',
    secondaryTcpPort: 502,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TcpSerialRelayApp – circuit breaker', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = new TcpSerialRelayApp();
    app.config = makeConfig();
  });

  // ── recordFailure ───────────────────────────────────────────────────────

  describe('recordFailure()', () => {
    it('triggers reboot on ECONNREFUSED matching secondaryTcpIp', () => {
      fs.readFileSync.mockReturnValue('0');

      app.recordFailure(new Error('connect ECONNREFUSED 192.168.1.100:502'));

      expect(fs.writeFileSync).toHaveBeenCalledWith(FAILURE_STATE_FILE, '1');
      expect(execSync).toHaveBeenCalledWith('sudo reboot');
    });

    it('increments count from existing state file value', () => {
      fs.readFileSync.mockReturnValue('5');

      app.recordFailure(new Error('connect ECONNREFUSED 192.168.1.100:502'));

      expect(fs.writeFileSync).toHaveBeenCalledWith(FAILURE_STATE_FILE, '6');
    });

    it('ignores errors without ECONNREFUSED', () => {
      app.recordFailure(new Error('ETIMEOUT 192.168.1.100'));

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(execSync).not.toHaveBeenCalled();
    });

    it('ignores ECONNREFUSED errors that do not match secondaryTcpIp', () => {
      app.recordFailure(new Error('connect ECONNREFUSED 10.0.0.99:502'));

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(execSync).not.toHaveBeenCalled();
    });

    it('ignores errors when config is not loaded', () => {
      app.config = null;

      app.recordFailure(new Error('connect ECONNREFUSED 192.168.1.100:502'));

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(execSync).not.toHaveBeenCalled();
    });

    it('handles missing state file gracefully (first failure)', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      app.recordFailure(new Error('connect ECONNREFUSED 192.168.1.100:502'));

      // count starts at 0, incremented to 1
      expect(fs.writeFileSync).toHaveBeenCalledWith(FAILURE_STATE_FILE, '1');
      expect(execSync).toHaveBeenCalledWith('sudo reboot');
    });
  });

  // ── clearFailures ──────────────────────────────────────────────────────

  describe('clearFailures()', () => {
    it('writes "0" to the state file', () => {
      app.clearFailures();

      expect(fs.writeFileSync).toHaveBeenCalledWith(FAILURE_STATE_FILE, '0');
    });

    it('logs error but does not throw if write fails', () => {
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => app.clearFailures()).not.toThrow();
    });
  });

  // ── Integration: 'started' event ──────────────────────────────────────

  describe('relay "started" event', () => {
    it('clears failures when relay emits "started"', async () => {
      const { loadConfig } = require('../../src/config');
      loadConfig.mockResolvedValue(makeConfig());

      await app.run();

      // The relay service is an EventEmitter mock — emit 'started'
      app.relayService.emit('started');

      expect(fs.writeFileSync).toHaveBeenCalledWith(FAILURE_STATE_FILE, '0');
    });
  });
});
