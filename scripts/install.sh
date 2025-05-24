#!/bin/bash

# TCP-Serial Relay Installation Script for Raspberry Pi
# This script installs and configures the relay service for cron execution

set -e

# Configuration
APP_NAME="tcp-serial-relay"
APP_USER="relay"
APP_DIR="/opt/$APP_NAME"
LOG_DIR="/var/log/$APP_NAME"
CONFIG_DIR="/etc/$APP_NAME"
SERVICE_DIR="/etc/systemd/system"
REPO_URL="https://github.com/yourusername/tcp-serial-relay.git"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root. Please run as a regular user with sudo privileges."
    fi
}

# Check if running on Raspberry Pi
check_raspberry_pi() {
    if ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
        warn "This doesn't appear to be a Raspberry Pi, but continuing anyway..."
    else
        log "Detected Raspberry Pi: $(cat /proc/device-tree/model)"
    fi
}

# Install system dependencies
install_dependencies() {
    log "Installing system dependencies..."
    
    sudo apt-get update -qq
    sudo apt-get install -y \
        curl \
        git \
        build-essential \
        python3-dev \
        libudev-dev \
        pkg-config \
        logrotate \
        cron
    
    # Install Node.js LTS if not present
    if ! command -v node &> /dev/null; then
        log "Installing Node.js LTS..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        log "Node.js already installed: $(node --version)"
    fi
    
    # Install PM2 for process management (optional)
    if ! command -v pm2 &> /dev/null; then
        log "Installing PM2..."
        sudo npm install -g pm2
    fi
}

# Create application user
create_user() {
    if ! id "$APP_USER" &>/dev/null; then
        log "Creating application user: $APP_USER"
        sudo useradd -r -s /bin/false -d $APP_DIR $APP_USER
        # Add user to dialout group for serial port access
        sudo usermod -a -G dialout $APP_USER
    else
        log "User $APP_USER already exists"
    fi
}

# Create directories
create_directories() {
    log "Creating application directories..."
    
    sudo mkdir -p $APP_DIR
    sudo mkdir -p $LOG_DIR
    sudo mkdir -p $CONFIG_DIR
    sudo mkdir -p $APP_DIR/logs
    sudo mkdir -p $APP_DIR/status
    
    # Set ownership
    sudo chown -R $APP_USER:$APP_USER $APP_DIR
    sudo chown -R $APP_USER:$APP_USER $LOG_DIR
    sudo chown -R root:$APP_USER $CONFIG_DIR
    sudo chmod 755 $CONFIG_DIR
}

# Install application
install_application() {
    log "Installing application to $APP_DIR..."
    
    # If local installation (script run from repo directory)
    if [[ -f "package.json" && -d "src" ]]; then
        log "Installing from local directory..."
        sudo cp -r . $APP_DIR/
        sudo rm -rf $APP_DIR/.git $APP_DIR/node_modules
    else
        # Clone from repository
        log "Cloning from repository: $REPO_URL"
        sudo git clone $REPO_URL $APP_DIR
    fi
    
    # Install npm dependencies
    cd $APP_DIR
    sudo -u $APP_USER npm install --production
    
    # Make scripts executable
    sudo chmod +x $APP_DIR/scripts/*.sh
    
    # Set proper ownership
    sudo chown -R $APP_USER:$APP_USER $APP_DIR
}

# Configure application
configure_application() {
    log "Setting up configuration..."
    
    # Create default configuration if it doesn't exist
    if [[ ! -f "$CONFIG_DIR/relay-config.json" ]]; then
        cat > /tmp/relay-config.json << EOF
{
  "tcpIp": "192.168.1.90",
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
EOF
        sudo mv /tmp/relay-config.json $CONFIG_DIR/
        sudo chown root:$APP_USER $CONFIG_DIR/relay-config.json
        sudo chmod 640 $CONFIG_DIR/relay-config.json
    fi
    
    # Create environment file
    cat > /tmp/relay.env << EOF
NODE_ENV=production
LOG_LEVEL=info
CONFIG_PATH=$CONFIG_DIR/relay-config.json
LOG_DIR=$LOG_DIR
APP_DIR=$APP_DIR
EOF
    sudo mv /tmp/relay.env $CONFIG_DIR/
    sudo chown root:$APP_USER $CONFIG_DIR/relay.env
    sudo chmod 640 $CONFIG_DIR/relay.env
}

# Setup systemd service (optional, for manual runs)
setup_systemd_service() {
    log "Creating systemd service..."
    
    cat > /tmp/$APP_NAME.service << EOF
[Unit]
Description=TCP-Serial Relay Service
After=network.target
Wants=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONFIG_DIR/relay.env
ExecStart=/usr/bin/node $APP_DIR/src/app.js
Restart=no
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$APP_NAME

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$LOG_DIR $APP_DIR/logs $APP_DIR/status $CONFIG_DIR

[Install]
WantedBy=multi-user.target
EOF
    
    sudo mv /tmp/$APP_NAME.service $SERVICE_DIR/
    sudo systemctl daemon-reload
    
    log "Systemd service created (not enabled by default for cron usage)"
}

# Setup cron job
setup_cron() {
    log "Setting up hourly cron job..."
    
    # Create cron script
    cat > /tmp/tcp-serial-relay-cron.sh << 'EOF'
#!/bin/bash

# TCP-Serial Relay Cron Script
# Runs the relay service and logs results

APP_DIR="/opt/tcp-serial-relay"
LOG_DIR="/var/log/tcp-serial-relay"
CONFIG_DIR="/etc/tcp-serial-relay"
STATUS_DIR="$APP_DIR/status"
LOCK_FILE="/tmp/tcp-serial-relay.lock"

# Source environment
if [[ -f "$CONFIG_DIR/relay.env" ]]; then
    source "$CONFIG_DIR/relay.env"
fi

# Function to log with timestamp
log_message() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_DIR/cron.log"
}

# Check if already running
if [[ -f "$LOCK_FILE" ]]; then
    pid=$(cat "$LOCK_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        log_message "Relay already running (PID: $pid), skipping this run"
        exit 0
    else
        log_message "Stale lock file found, removing..."
        rm -f "$LOCK_FILE"
    fi
fi

# Create lock file
echo $$ > "$LOCK_FILE"

# Ensure status directory exists
mkdir -p "$STATUS_DIR"

# Generate unique run ID
RUN_ID="cron-$(date +'%Y%m%d-%H%M%S')-$$"
STATUS_FILE="$STATUS_DIR/status-$RUN_ID.json"

log_message "Starting relay service (Run ID: $RUN_ID)"

# Change to app directory
cd "$APP_DIR" || {
    log_message "ERROR: Cannot change to app directory: $APP_DIR"
    rm -f "$LOCK_FILE"
    exit 1
}

# Run the relay service
timeout 300 node src/app.js 2>&1 | tee -a "$LOG_DIR/cron.log"
EXIT_CODE=${PIPESTATUS[0]}

# Check results
if [[ $EXIT_CODE -eq 0 ]]; then
    log_message "Relay service completed successfully (Run ID: $RUN_ID)"
elif [[ $EXIT_CODE -eq 124 ]]; then
    log_message "Relay service timed out after 5 minutes (Run ID: $RUN_ID)"
else
    log_message "Relay service failed with exit code $EXIT_CODE (Run ID: $RUN_ID)"
fi

# Clean up old status files (keep last 24)
find "$STATUS_DIR" -name "status-*.json" -mtime +1 -delete 2>/dev/null || true

# Remove lock file
rm -f "$LOCK_FILE"

log_message "Cron job completed (Run ID: $RUN_ID, Exit Code: $EXIT_CODE)"
exit $EXIT_CODE
EOF
    
    sudo mv /tmp/tcp-serial-relay-cron.sh $APP_DIR/scripts/
    sudo chmod +x $APP_DIR/scripts/tcp-serial-relay-cron.sh
    sudo chown $APP_USER:$APP_USER $APP_DIR/scripts/tcp-serial-relay-cron.sh
    
    # Add to crontab for the app user
    log "Adding cron job for user $APP_USER..."
    
    # Create crontab entry
    echo "0 * * * * $APP_DIR/scripts/tcp-serial-relay-cron.sh" | sudo -u $APP_USER crontab -
    
    log "Cron job installed: runs every hour at minute 0"
}

# Setup log rotation
setup_logrotate() {
    log "Setting up log rotation..."
    
    cat > /tmp/$APP_NAME << EOF
$LOG_DIR/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 $APP_USER $APP_USER
    postrotate
        # Signal application to reopen log files if needed
        /bin/true
    endscript
}

$APP_DIR/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 $APP_USER $APP_USER
}
EOF
    
    sudo mv /tmp/$APP_NAME /etc/logrotate.d/
    sudo chmod 644 /etc/logrotate.d/$APP_NAME
}

# Create monitoring script
create_monitoring_script() {
    log "Creating monitoring script..."
    
    cat > /tmp/monitor.sh << 'EOF'
#!/bin/bash

# TCP-Serial Relay Monitoring Script

APP_DIR="/opt/tcp-serial-relay"
LOG_DIR="/var/log/tcp-serial-relay"
STATUS_DIR="$APP_DIR/status"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== TCP-Serial Relay Monitor ==="
echo "Date: $(date)"
echo

# Check if cron job is configured
echo "Cron Job Status:"
if sudo -u relay crontab -l 2>/dev/null | grep -q "tcp-serial-relay-cron.sh"; then
    echo -e "${GREEN}✓ Cron job configured${NC}"
    echo "Schedule: $(sudo -u relay crontab -l | grep tcp-serial-relay-cron.sh)"
else
    echo -e "${RED}✗ Cron job not configured${NC}"
fi

echo

# Check recent log activity
echo "Recent Activity:"
if [[ -f "$LOG_DIR/cron.log" ]]; then
    echo "Last 5 cron entries:"
    tail -n 5 "$LOG_DIR/cron.log" | while read line; do
        if echo "$line" | grep -q "completed successfully"; then
            echo -e "${GREEN}$line${NC}"
        elif echo "$line" | grep -q "failed\|ERROR"; then
            echo -e "${RED}$line${NC}"
        else
            echo "$line"
        fi
    done
else
    echo -e "${YELLOW}No cron log found${NC}"
fi

echo

# Check disk usage
echo "Disk Usage:"
df -h "$LOG_DIR" 2>/dev/null || df -h /

echo

# Check serial ports
echo "Available Serial Ports:"
if command -v node &> /dev/null; then
    cd "$APP_DIR" && node -e "
        const SerialClient = require('./src/services/serial-client');
        SerialClient.listPorts()
            .then(ports => {
                if (ports.length === 0) {
                    console.log('No serial ports found');
                } else {
                    ports.forEach(port => {
                        console.log(\`\${port.path} - \${port.manufacturer || 'Unknown'}\`);
                    });
                }
            })
            .catch(err => console.log('Error listing ports:', err.message));
    " 2>/dev/null || echo "Cannot list serial ports"
else
    echo "Node.js not available"
fi

echo

# Show recent status files
echo "Recent Status Files:"
if [[ -d "$STATUS_DIR" ]]; then
    ls -la "$STATUS_DIR"/status-*.json 2>/dev/null | tail -5 || echo "No status files found"
else
    echo "Status directory not found"
fi
EOF
    
    sudo mv /tmp/monitor.sh $APP_DIR/scripts/
    sudo chmod +x $APP_DIR/scripts/monitor.sh
    sudo chown root:root $APP_DIR/scripts/monitor.sh
}

# Display completion message
show_completion_message() {
    log "Installation completed successfully!"
    echo
    echo -e "${BLUE}=== Installation Summary ===${NC}"
    echo "Application installed to: $APP_DIR"
    echo "Configuration directory: $CONFIG_DIR"
    echo "Log directory: $LOG_DIR"
    echo "Service user: $APP_USER"
    echo
    echo -e "${BLUE}=== Next Steps ===${NC}"
    echo "1. Edit configuration: sudo nano $CONFIG_DIR/relay-config.json"
    echo "2. Test the service: sudo -u $APP_USER $APP_DIR/scripts/tcp-serial-relay-cron.sh"
    echo "3. Monitor activity: sudo $APP_DIR/scripts/monitor.sh"
    echo "4. View logs: tail -f $LOG_DIR/cron.log"
    echo
    echo -e "${BLUE}=== Cron Schedule ===${NC}"
    echo "The service will run automatically every hour at minute 0"
    echo "Check cron status: sudo -u $APP_USER crontab -l"
    echo
    echo -e "${YELLOW}Note: Make sure to configure your TCP server IP and serial port in the config file!${NC}"
}

# Main installation function
main() {
    log "Starting TCP-Serial Relay installation for Raspberry Pi..."
    
    check_root
    check_raspberry_pi
    install_dependencies
    create_user
    create_directories
    install_application
    configure_application
    setup_systemd_service
    setup_cron
    setup_logrotate
    create_monitoring_script
    show_completion_message
}

# Run main function
main "$@"