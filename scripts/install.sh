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

# Install Node.js
install_nodejs() {
    log_info "Installing Node.js..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        log_info "Node.js is already installed: $NODE_VERSION"
        
        if [[ "$NODE_VERSION" < "v16" ]]; then
            log_warning "Node.js version is too old. Installing newer version..."
        else
            log_success "Node.js version is acceptable"
            return 0
        fi
    fi
    
    case $DISTRO in
        "ubuntu"|"debian"|"raspbian")
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

# Install Docker
install_docker() {
    log_info "Installing Docker..."
    
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
        log_info "Docker is already installed: $DOCKER_VERSION"
        return 0
    fi
    
    case $DISTRO in
        "ubuntu"|"debian"|"raspbian")
            apt-get update
            apt-get install -y docker.io
            systemctl enable docker
            systemctl start docker
            ;;
        "centos"|"rhel")
            yum install -y docker
            systemctl enable docker
            systemctl start docker
            ;;
        "fedora")
            dnf install -y docker
            systemctl enable docker
            systemctl start docker
            ;;
        "alpine")
            apk add --no-cache docker
            rc-update add docker boot
            service docker start
            ;;
        *)
            log_error "Cannot install Docker for distribution: $DISTRO"
            exit 1
            ;;
    esac
    
    # Add relay user to docker group
    usermod -a -G docker "$APP_USER" 2>/dev/null || log_warning "Could not add user to docker group"
    
    log_success "Docker installed and configured"
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
    
    useradd --system --home-dir "$APP_DIR" --shell /bin/false --comment "TCP-Serial Relay Service" "$APP_USER"
    
    usermod -a -G dialout "$APP_USER" 2>/dev/null || log_warning "Could not add user to dialout group"
    
    log_success "Application user created: $APP_USER"
}

# Create directory structure
create_directories() {
    log_info "Creating directory structure..."
    
    mkdir -p "$APP_DIR"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR/certs"
    mkdir -p "$LOG_DIR"
    
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    chown -R "$APP_USER:$APP_USER" "$CONFIG_DIR"
    chown -R "$APP_USER:$APP_USER" "$LOG_DIR"
    
    chmod 755 "$APP_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR/certs"
    chmod 755 "$LOG_DIR"
    
    log_success "Directory structure created"
}

# Copy application files
copy_app_files() {
    log_info "Copying application files..."
    
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." &> /dev/null && pwd )"
    
    cp -r "$SCRIPT_DIR"/* "$APP_DIR/" 2>/dev/null || {
        log_error "Failed to copy application files. Make sure this script is in the application root directory."
        exit 1
    }
    
    rm -rf "$APP_DIR/scripts"
    
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    
    chmod +x "$APP_DIR/src/app.js" 2>/dev/null || chmod +x "$APP_DIR/app.js" 2>/dev/null || true
    
    log_success "Application files copied"
}

# Install Node.js dependencies
install_node_deps() {
    log_info "Installing Node.js dependencies..."
    
    cd "$APP_DIR"
    
    if command -v sudo &> /dev/null; then
        sudo -u "$APP_USER" npm install --production
    else
        chown -R "$APP_USER:$APP_USER" "$APP_DIR"
        su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm install --production"
    fi
    
    log_success "Node.js dependencies installed"
}

# Create default configuration
create_config() {
    log_info "Creating default configuration..."
    
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
    
    # Determine architecture for Docker tag
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm"* ]]; then
        DOCKER_TAG="armv7-latest"
    else
        DOCKER_TAG="arm64-latest"
    fi
    
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
        IOT_ENDPOINT: 'a35oe2953aualt-ats.iot.us-east-1.amazonaws.com',
        DOCKER_IMAGE: 'public.ecr.aws/aws-iot-securetunneling-localproxy/ubuntu-bin',
        DOCKER_TAG: '${DOCKER_TAG}',
        DESTINATION_PORT: '22'
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

# Create systemd service for PM2
create_systemd_service() {
    log_info "Creating systemd service..."
    
    cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=TCP-Serial Relay IoT Service
Documentation=https://pm2.keymetrics.io/
After=network.target docker.service

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

# Setup firewall rules
setup_firewall() {
    log_info "Checking firewall configuration..."
    
    if command -v ufw &> /dev/null; then
        log_info "UFW detected - opening destination port (22) for secure tunneling"
        ufw allow 22/tcp comment 'TCP-Serial Relay Secure Tunneling'
        ufw reload
    elif command -v firewall-cmd &> /dev/null; then
        log_info "Firewalld detected - opening destination port (22) for secure tunneling"
        firewall-cmd --permanent --add-port=22/tcp --add-port-comment="TCP-Serial Relay Secure Tunneling"
        firewall-cmd --reload
    else
        log_warning "No supported firewall detected. Ensure port 22 (or your configured DESTINATION_PORT) is open if needed."
    fi
    
    log_success "Firewall configuration completed"
}

# Start services
start_services() {
    log_info "Starting services..."
    
    systemctl start ${SERVICE_NAME}
    
    sleep 3
    
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "Service started successfully"
        sudo -u "$APP_USER" pm2 status
    else
        log_error "Service failed to start"
        systemctl status ${SERVICE_NAME}
        exit 1
    fi
}

# Get MAC address for AWS IoT Thing registration
get_mac_address() {
    for interface in eth0 wlan0 en0 enp0s3 ens33; do
        if [ -d "/sys/class/net/$interface" ]; then
            MAC=$(cat /sys/class/net/$interface/address 2>/dev/null | tr -d ':' | tr '[:upper:]' '[:lower:]')
            if [ -n "$MAC" ] && [ "$MAC" != "000000000000" ]; then
                echo "$MAC"
                return
            fi
        fi
    done
    
    MAC=$(ip link show | grep -E "link/ether" | head -1 | awk '{print $2}' | tr -d ':' | tr '[:upper:]' '[:lower:]')
    if [ -n "$MAC" ] && [ "$MAC" != "000000000000" ]; then
        echo "$MAC"
        return
    fi
    
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
    echo "  3. Ensure Docker is running: systemctl status docker"
    echo "  4. Restart the service: systemctl restart $SERVICE_NAME"
    echo "  5. Monitor the logs: journalctl -u $SERVICE_NAME -f"
    echo
    echo -e "${YELLOW}IoT Sidecar Features:${NC}"
    echo "  - Device Shadow updates for remote config changes"
    echo "  - Secure tunneling support via Docker container"
    echo "  - Remote command execution (run, stop, restart)"
    echo "  - Status reporting to AWS IoT Core"
    echo
    echo -e "${YELLOW}Note:${NC} Make sure your serial ports, network settings, and IoT certificates"
    echo "are correct in the configuration files before starting operations."
    echo "Ensure the destination port (default: 22) is open and the target service is running."
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
    install_nodejs
    install_docker
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