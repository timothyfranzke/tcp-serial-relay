# Changelog

All notable changes to the TCP-Serial Relay package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Additional CLI commands for fleet management
- Enhanced monitoring capabilities
- Configuration templates and validation

### Changed
- Improved error handling and retry logic
- Better logging performance for high-frequency data

### Fixed
- Memory leak in long-running services
- Serial port reconnection edge cases

## [1.0.0] - 2024-01-15

### Added
- 🎉 Initial release of TCP-Serial Relay as npm package
- Complete CLI interface with `tcp-serial-relay` command
- Automatic setup and configuration for Raspberry Pi
- Comprehensive health monitoring system
- Flexible service installation (cron and systemd)
- Real-time log viewing and management
- Configuration management with validation
- Serial port discovery and listing
- Mock mode for testing without hardware
- Automatic updates via npm
- Post-install setup automation

### Features
- **Bidirectional TCP ↔ Serial relay** with automatic reconnection
- **Industrial-grade reliability** with comprehensive error handling
- **Modular architecture** with separate TCP and Serial clients
- **Event-driven design** for responsive data handling
- **Comprehensive logging** with Winston and log rotation
- **Status tracking** with JSON status files for monitoring
- **Device identification** using MAC address
- **Configuration validation** with detailed error reporting
- **Health checks** with multiple output formats
- **Graceful shutdown** with proper resource cleanup

### CLI Commands
- `tcp-serial-relay start` - Start the relay service
- `tcp-serial-relay stop` - Stop the relay service
- `tcp-serial-relay status` - Check service status
- `tcp-serial-relay health` - Run health diagnostics
- `tcp-serial-relay config` - Manage configuration
- `tcp-serial-relay logs` - View service logs
- `tcp-serial-relay list-ports` - List available serial ports
- `tcp-serial-relay install-service` - Install as system service
- `tcp-serial-relay update` - Check for and install updates

### Installation
- Global npm package installation: `npm install -g @yourcompany/tcp-serial-relay`
- Automatic directory creation and permission setup
- Default configuration generation
- Service user creation with proper permissions
- Log rotation setup

### Configuration
- JSON-based configuration with environment variable overrides
- Comprehensive validation with helpful error messages
- Backup and restore functionality
- Template generation for easy setup
- Support for multiple deployment environments

### Monitoring
- Health check system with configurable thresholds
- Multiple output formats (console, JSON, Prometheus)
- System resource monitoring
- Connection status tracking
- Recent activity analysis
- Alert generation for various conditions

### Logging
- Structured logging with Winston
- Daily log rotation with compression
- Separate logs for different purposes (app, error, data transfer)
- Configurable log levels
- Real-time log viewing via CLI

### Service Management
- Cron job installation for periodic operation
- Systemd service for continuous operation
- Process management with PID files and locks
- Automatic cleanup of old status and log files
- Graceful service restart capabilities

### Security
- Dedicated service user with minimal permissions
- Secure configuration file handling
- Protection against common security issues
- Proper resource isolation

### Testing
- Mock mode for testing without hardware
- Comprehensive test suite
- Integration testing capabilities
- Hardware simulation for development

### Documentation
- Complete README with usage examples
- Deployment guide for Raspberry Pi fleets
- Troubleshooting documentation
- API reference documentation
- Configuration schema documentation

### Compatibility
- Node.js 14+ support
- Linux and macOS compatibility
- ARM and x64 architecture support
- Raspberry Pi optimized installation

---

## Version History

### Pre-release Development
- **v0.9.0** - Beta testing with selected customers
- **v0.8.0** - Feature complete implementation
- **v0.7.0** - CLI interface development
- **v0.6.0** - Configuration management system
- **v0.5.0** - Health monitoring implementation
- **v0.4.0** - Service installation automation
- **v0.3.0** - Logging system enhancement
- **v0.2.0** - Event-driven architecture refactor
- **v0.1.0** - Initial modular implementation

---

## Migration Guide

### From Legacy Installation to npm Package

If you're upgrading from a previous manual installation:

1. **Stop existing services**
   ```bash
   # Stop any running instances
   sudo systemctl stop tcp-serial-relay 2>/dev/null || true
   sudo -u relay crontab -r 2>/dev/null || true
   ```

2. **Backup existing configuration**
   ```bash
   sudo cp /etc/tcp-serial-relay/relay-config.json /tmp/relay-config-backup.json
   ```

3. **Install npm package**
   ```bash
   sudo npm install -g @yourcompany/tcp-serial-relay
   ```

4. **Restore configuration**
   ```bash
   sudo cp /tmp/relay-config-backup.json /etc/tcp-serial-relay/relay-config.json
   tcp-serial-relay config --validate
   ```

5. **Reinstall service**
   ```bash
   tcp-serial-relay install-service --cron
   ```

### Breaking Changes

None in this initial release.

### Deprecation Notices

- Legacy `job.js` entry point is maintained for backward compatibility but will be removed in v2.0.0
- Direct file-based configuration management will be replaced by the CLI tools in future versions

---

## Support and Feedback

- **Issues**: [GitHub Issues](https://github.com/timothyfranzke/tcp-serial-relay/issues)
- **Discussions**: [GitHub Discussions](https://github.com/timothyfranzke/tcp-serial-relay/discussions)
- **Documentation**: [GitHub Wiki](https://github.com/timothyfranzke/tcp-serial-relay/wiki)
- **Email**: support@franzkecreative.com

## Contributors

- Development Team [@timothyfranzke](https://github.com/timothyfranzke)
- Community contributors and beta testers

---

*For detailed technical documentation, see the [README](README.md) and [deployment guide](docs/deployment.md).*