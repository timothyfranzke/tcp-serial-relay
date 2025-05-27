# TCP-Serial Relay

A modular TCP to Serial relay service with comprehensive logging, monitoring, and a web dashboard.

## Features

- **Bidirectional Relay**: Relay data between TCP and Serial connections
- **Robust Error Handling**: Automatic reconnection and comprehensive error recovery
- **Detailed Logging**: Configurable logging with rotation support
- **Web Dashboard**: Modern Next.js dashboard for monitoring and configuration
- **Command Line Interface**: Comprehensive CLI for service management
- **Configurable**: Extensive configuration options via JSON file
- **Health Monitoring**: Built-in health checks and status reporting

## Installation

```bash
# Install globally
npm install -g tcp-serial-relay

# Or install locally
npm install tcp-serial-relay
```

## Quick Start

```bash
# Start the relay service with dashboard
tcp-serial-relay dashboard

# Start the relay service only
tcp-serial-relay start

# View service status
tcp-serial-relay status

# View logs
tcp-serial-relay logs
```

## Web Dashboard

The TCP-Serial Relay includes a modern Next.js dashboard for monitoring and configuring the service. The dashboard provides:

- Real-time status monitoring
- Configuration management
- Log viewing
- Service control (start/stop/restart)

### Starting the Dashboard

```bash
# Start both the relay service and dashboard
tcp-serial-relay dashboard

# Start with custom port (default: 3000)
tcp-serial-relay dashboard --port 8080

# Start with custom configuration file
tcp-serial-relay dashboard --config /path/to/config.json

# Start in mock mode for testing
tcp-serial-relay dashboard --mock
```

### Dashboard Features

- **Status Tab**: View real-time connection status and metrics
- **Configuration Tab**: Edit and manage relay configuration
- **Logs Tab**: View service logs
- **Control Tab**: Start, stop, and restart the relay service

## Configuration

The relay service is configured using a JSON file located at `config/relay-config.json`. You can specify a custom configuration file using the `--config` option.

Example configuration:

```json
{
  "tcpIp": "127.0.0.1",
  "tcpPort": 10002,
  "serialPath": "/dev/ttyUSB0",
  "serialBaud": 9600,
  "serialParity": "odd",
  "serialDataBits": 7,
  "serialStopBits": 1,
  "maxRetries": 3,
  "retryDelay": 5000,
  "connectionTimeout": 10000,
  "relayTimeout": 30000,
  "logDataTransfers": true,
  "logLevel": "info"
}
```

## CLI Commands

The TCP-Serial Relay provides a comprehensive command-line interface:

```bash
Usage: tcp-serial-relay [options] [command]

Options:
  -V, --version                 output the version number
  -h, --help                    display help for command

Commands:
  start [options]               Start the relay service
  stop                          Stop the relay service
  status                        Check service status
  setup [options]               Setup service on Raspberry Pi
  health [options]              Run health check
  list-ports                    List available serial ports
  config [options]              Manage configuration
  logs [options]                View service logs
  update [options]              Check for updates
  dashboard [options]           Start the relay service with web dashboard
  help [command]                display help for command
```

### Dashboard Command

```bash
Usage: tcp-serial-relay dashboard [options]

Start the relay service with web dashboard

Options:
  -c, --config <path>  Configuration file path
  -p, --port <port>    Dashboard port (default: "3000")
  --mock               Run in mock mode for testing
  --debug              Enable debug logging
  -h, --help           display help for command
```

## Development

### Building the Dashboard

The dashboard is built using Next.js. To build the dashboard:

```bash
# Build the dashboard
npm run build:dashboard

# Run the dashboard in development mode
npm run dev
```

### Project Structure

- `/bin`: CLI entry point
- `/config`: Configuration files
- `/dashboard`: Next.js dashboard application
- `/scripts`: Utility scripts
- `/src`: Main application code
- `/tests`: Test files

## License

MIT