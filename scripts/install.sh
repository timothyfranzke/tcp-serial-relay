#!/bin/bash

# TCP-Serial Relay IoT Application Installation Script
# For distributed Linux devices connecting to gas meters

set -e  # Exit on any error

# Configuration
APP_NAME="tcp-serial-relay"
APP_USER="relay"
APP_DIR="/opt/${APP_NAME}"
CONFIG_DIR="/etc/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Detect Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        VERSION=$VERSION_ID
    else
        log_error "Cannot detect Linux distribution"
        exit 1
    fi
    log_info "Detected distribution: $DISTRO $VERSION"
}

# Install system dependencies
install_system_deps() {
    log_info "Installing system dependencies..."
    
    case $DISTRO in
        "ubuntu"|"debian")
            apt-get update
            apt-get install -y curl wget gnupg2 software-properties-common build-essential sudo
            # For serial port access
            apt-get install -y udev
            ;;
        "centos"|"rhel"|"fedora")
            if command -v dnf &> /dev/null; then
                dnf update -y
                dnf install -y curl wget gnupg2 gcc gcc-c++ make
            else
                yum update -y
                yum install -y curl wget gnupg2 gcc gcc-c++ make
            fi
            ;;
        "alpine")
            apk update
            apk add --no-cache curl wget gnupg build-base linux-headers udev
            ;;
        *)
            log_warning "Unsupported distribution: $DISTRO. Continuing anyway..."
            ;;
    esac
    
    log_success "System dependencies installed"
}

# Install Node.js
install_nodejs() {
    log_info "Installing Node.js..."
    
    # Check if Node.js is already installed
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        log_info "Node.js is already installed: $NODE_VERSION"
        
        # Check if version is recent enough (v16+)
        if [[ "$NODE_VERSION" < "v16" ]]; then
            log_warning "Node.js version is too old. Installing newer version..."
        else
            log_success "Node.js version is acceptable"
            return 0
        fi
    fi
    
    # Install Node.js via NodeSource repository
    case $DISTRO in
        "ubuntu"|"debian")
            curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
            apt-get install -y nodejs
            ;;
        "centos"|"rhel"|"fedora")
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
            if command -v dnf &> /dev/null; then
                dnf install -y nodejs npm
            else
                yum install -y nodejs npm
            fi
            ;;
        "alpine")
            apk add --no-cache nodejs npm
            ;;
        *)
            log_error "Cannot install Node.js for distribution: $DISTRO"
            exit 1
            ;;
    esac
    
    log_success "Node.js installed: $(node --version)"
}

# Install PM2 globally
install_pm2() {
    log_info "Installing PM2 process manager..."
    
    if command -v pm2 &> /dev/null; then
        log_info "PM2 is already installed: $(pm2 --version)"
        return 0
    fi
    
    npm install -g pm2
    
    log_success "PM2 installed"
}

# Create application user
create_app_user() {
    log_info "Creating application user: $APP_USER"
    
    if id "$APP_USER" &>/dev/null; then
        log_info "User $APP_USER already exists"
        return 0
    fi
    
    # Create user with no login shell and home directory
    useradd --system --home-dir "$APP_DIR" --shell /bin/false --comment "TCP-Serial Relay Service" "$APP_USER"
    
    # Add user to dialout group for serial port access
    usermod -a -G dialout "$APP_USER" 2>/dev/null || log_warning "Could not add user to dialout group"
    
    log_success "Application user created: $APP_USER"
}

# Create directory structure
create_directories() {
    log_info "Creating directory structure..."
    
    # Create main directories
    mkdir -p "$APP_DIR"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR/certs"
    mkdir -p "$LOG_DIR"
    
    # Set ownership
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    chown -R "$APP_USER:$APP_USER" "$CONFIG_DIR"
    chown -R "$APP_USER:$APP_USER" "$LOG_DIR"
    
    # Set permissions
    chmod 755 "$APP_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR/certs"  # Secure certs directory
    chmod 755 "$LOG_DIR"
    
    log_success "Directory structure created"
}

# Copy application files
copy_app_files() {
    log_info "Copying application files..."
    
    # Determine source directory (project root - parent of scripts directory)
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." &> /dev/null && pwd )"
    
    # Copy main application files
    cp -r "$SCRIPT_DIR"/* "$APP_DIR/" 2>/dev/null || {
        log_error "Failed to copy application files. Make sure this script is in the application root directory."
        exit 1
    }
    
    # Remove the scripts directory from the app directory since it's not needed in production
    rm -rf "$APP_DIR/scripts"
    
    # Set ownership
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    
    # Make main script executable
    chmod +x "$APP_DIR/src/app.js" 2>/dev/null || chmod +x "$APP_DIR/app.js" 2>/dev/null || true
    
    log_success "Application files copied"
}

# Install Node.js dependencies
install_node_deps() {
    log_info "Installing Node.js dependencies..."
    
    cd "$APP_DIR"
    
    # Install production dependencies as the app user
    if command -v sudo &> /dev/null; then
        sudo -u "$APP_USER" npm install --production
    else
        # Fallback for systems without sudo - change ownership temporarily
        chown -R "$APP_USER:$APP_USER" "$APP_DIR"
        su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm install --production"
    fi
    
    log_success "Node.js dependencies installed"
}

# Create default configuration
create_config() {
    log_info "Creating default configuration..."
    
    # Create default config file if it doesn't exist
    if [ ! -f "$CONFIG_DIR/relay-config.json" ]; then
        cat > "$CONFIG_DIR/relay-config.json" << EOF
{
  "tcpIp": "192.168.1.90",
  "tcpPort": 10002,
  "connectionType": "serial",
  "serialPath": "/dev/ttyUSB0",
  "serialBaud": 9600,
  "serialParity": "odd",
  "serialDataBits": 7,
  "serialStopBits": 1,
  "secondaryTcpIp": "192.168.1.91",
  "secondaryTcpPort": 10003,
  "maxRetries": 3,
  "retryDelay": 5000,
  "connectionTimeout": 10000,
  "relayTimeout": 30000,
  "bufferSize": 1024,
  "logDataTransfers": true,
  "logLevel": "info",
  "collectLogs": false,
  "collectData": false
}
EOF
        
        chown "$APP_USER:$APP_USER" "$CONFIG_DIR/relay-config.json"
        chmod 644 "$CONFIG_DIR/relay-config.json"
        
        log_success "Default configuration created at $CONFIG_DIR/relay-config.json"
    else
        log_info "Configuration file already exists"
    fi
}

# Create PM2 ecosystem file
create_pm2_config() {
    log_info "Creating PM2 ecosystem configuration..."
    
    cat > "$APP_DIR/ecosystem.config.js" << EOF
module.exports = {
  apps: [
    {
      name: '${SERVICE_NAME}',
      script: './src/app.js',
      cwd: '${APP_DIR}',
      user: '${APP_USER}',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 * * * *',
      restart_delay: 5000,
      autorestart: false,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        CONFIG_PATH: '${CONFIG_DIR}/relay-config.json'
      },
      log_file: '${LOG_DIR}/combined.log',
      out_file: '${LOG_DIR}/out.log',
      error_file: '${LOG_DIR}/error.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      retain_logs: 10
    },
    {
      name: '${SERVICE_NAME}-iot-sidecar',
      script: './src/iot-sidecar.js',
      cwd: '${APP_DIR}',
      user: '${APP_USER}',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        CONFIG_PATH: '${CONFIG_DIR}/relay-config.json',
        IOT_THING_NAME: 'tcp-serial-relay-device',
        IOT_CERT_PATH: '${CONFIG_DIR}/certs/certificate.pem.crt',
        IOT_KEY_PATH: '${CONFIG_DIR}/certs/private.pem.key',
        IOT_CA_PATH: '${CONFIG_DIR}/certs/AmazonRootCA1.pem',
        IOT_ENDPOINT: ''
      },
      log_file: '${LOG_DIR}/iot-sidecar-combined.log',
      out_file: '${LOG_DIR}/iot-sidecar-out.log',
      error_file: '${LOG_DIR}/iot-sidecar-error.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      retain_logs: 10
    }
  ]
};
EOF
    
    chown "$APP_USER:$APP_USER" "$APP_DIR/ecosystem.config.js"
    
    log_success "PM2 ecosystem configuration created"
}

# Setup udev rules for serial ports
setup_udev_rules() {
    log_info "Setting up udev rules for serial port access..."
    
    cat > /etc/udev/rules.d/99-tcp-serial-relay.rules << EOF
# TCP-Serial Relay udev rules
# Allow access to serial ports for the relay user
SUBSYSTEM=="tty", GROUP="dialout", MODE="0664"
KERNEL=="ttyUSB*", GROUP="dialout", MODE="0664"
KERNEL=="ttyACM*", GROUP="dialout", MODE="0664"
KERNEL=="ttyS*", GROUP="dialout", MODE="0664"
EOF
    
    # Reload udev rules
    udevadm control --reload-rules
    udevadm trigger
    
    log_success "Udev rules configured"
}

# Setup log rotation
setup_log_rotation() {
    log_info "Setting up log rotation..."
    
    cat > /etc/logrotate.d/${SERVICE_NAME} << EOF
${LOG_DIR}/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        /usr/bin/pm2 reloadLogs
    endscript
}
EOF
    
    log_success "Log rotation configured"
}

# Create systemd service for PM2 (alternative to PM2 startup)
create_systemd_service() {
    log_info "Creating systemd service..."
    
    cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=TCP-Serial Relay IoT Service
Documentation=https://pm2.keymetrics.io/
After=network.target

[Service]
Type=forking
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=${APP_DIR}
Environment=PM2_HOME=${APP_DIR}/.pm2
ExecStart=/usr/bin/pm2 start ${APP_DIR}/ecosystem.config.js
ExecReload=/usr/bin/pm2 reload ${APP_DIR}/ecosystem.config.js
ExecStop=/usr/bin/pm2 stop ${APP_DIR}/ecosystem.config.js
Restart=always
RestartSec=5
PIDFile=${APP_DIR}/.pm2/pm2.pid

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    
    log_success "Systemd service created and enabled"
}

# Setup firewall rules (if needed)
setup_firewall() {
    log_info "Checking firewall configuration..."
    
    # This is optional - only set up if specific ports need to be opened
    # for the dashboard server or other services
    
    if command -v ufw &> /dev/null; then
        # Ubuntu/Debian UFW
        log_info "UFW detected - you may need to configure firewall rules manually"
    elif command -v firewall-cmd &> /dev/null; then
        # CentOS/RHEL firewalld
        log_info "Firewalld detected - you may need to configure firewall rules manually"
    fi
    
    log_info "Firewall check completed"
}

# Start services
start_services() {
    log_info "Starting services..."
    
    # Start the systemd service
    systemctl start ${SERVICE_NAME}
    
    # Wait a moment for startup
    sleep 3
    
    # Check status
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "Service started successfully"
        
        # Show PM2 status
        sudo -u "$APP_USER" pm2 status
    else
        log_error "Service failed to start"
        systemctl status ${SERVICE_NAME}
        exit 1
    fi
}

# Get MAC address for AWS IoT Thing registration
get_mac_address() {
    # Try to get MAC address from common network interfaces
    for interface in eth0 wlan0 en0 enp0s3 ens33; do
        if [ -d "/sys/class/net/$interface" ]; then
            MAC=$(cat /sys/class/net/$interface/address 2>/dev/null | tr -d ':' | tr '[:upper:]' '[:lower:]')
            if [ -n "$MAC" ] && [ "$MAC" != "000000000000" ]; then
                echo "$MAC"
                return
            fi
        fi
    done
    
    # Fallback: use ip command
    MAC=$(ip link show | grep -E "link/ether" | head -1 | awk '{print $2}' | tr -d ':' | tr '[:upper:]' '[:lower:]')
    if [ -n "$MAC" ] && [ "$MAC" != "000000000000" ]; then
        echo "$MAC"
        return
    fi
    
    # Ultimate fallback
    echo "unknown"
}

# Print installation summary
print_summary() {
    echo
    log_success "=========================================="
    log_success "Installation completed successfully!"
    log_success "=========================================="
    echo
    echo -e "${BLUE}Service Details:${NC}"
    echo "  - Service Name: $SERVICE_NAME"
    echo "  - Application Directory: $APP_DIR"
    echo "  - Configuration Directory: $CONFIG_DIR"
    echo "  - Log Directory: $LOG_DIR"
    echo "  - User: $APP_USER"
    echo
    echo -e "${BLUE}AWS IoT Core Thing Registration:${NC}"
    DEVICE_MAC=$(get_mac_address)
    echo "  - Thing Name (MAC Address): $DEVICE_MAC"
    echo "  - Register this MAC address as a Thing in AWS IoT Core"
    echo "  - Download certificates and place in: $CONFIG_DIR/certs/"
    echo
    echo -e "${BLUE}Useful Commands:${NC}"
    echo "  - Check service status: systemctl status $SERVICE_NAME"
    echo "  - View logs: journalctl -u $SERVICE_NAME -f"
    echo "  - PM2 status: sudo -u $APP_USER pm2 status"
    echo "  - View PM2 logs: sudo -u $APP_USER pm2 logs"
    echo "  - Edit configuration: nano $CONFIG_DIR/relay-config.json"
    echo "  - Restart service: systemctl restart $SERVICE_NAME"
    echo
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Edit the configuration file: $CONFIG_DIR/relay-config.json"
    echo "  2. Configure AWS IoT Core certificates in: $CONFIG_DIR/certs/"
    echo "     - Place certificate.pem.crt, private.pem.key, and AmazonRootCA1.pem"
    echo "     - Update IOT_ENDPOINT in the ecosystem config"
    echo "  3. Restart the service: systemctl restart $SERVICE_NAME"
    echo "  4. Monitor the logs: journalctl -u $SERVICE_NAME -f"
    echo
    echo -e "${YELLOW}IoT Sidecar Features:${NC}"
    echo "  - Device Shadow updates for remote config changes"
    echo "  - Secure tunneling support for remote access"
    echo "  - Remote command execution (run, stop, restart)"
    echo "  - Status reporting to AWS IoT Core"
    echo
    echo -e "${YELLOW}Note:${NC} Make sure your serial ports, network settings, and IoT certificates"
    echo "are correct in the configuration files before starting operations."
    echo
}

# Main installation function
main() {
    echo
    log_info "=========================================="
    log_info "TCP-Serial Relay IoT Installation Script"
    log_info "=========================================="
    echo
    
    check_root
    detect_distro
    install_system_deps
    install_nodejs
    install_pm2
    create_app_user
    create_directories
    copy_app_files
    install_node_deps
    create_config
    create_pm2_config
    setup_udev_rules
    setup_log_rotation
    create_systemd_service
    setup_firewall
    start_services
    print_summary
}

# Run main function
main "$@"