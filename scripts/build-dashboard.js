#!/usr/bin/env node

// scripts/build-dashboard.js
// Build script for the TCP-Serial Relay Dashboard

const fs = require('fs');
const path = require('path');

console.log('Building TCP-Serial Relay Dashboard...');

// Create dashboard directory
const dashboardDir = path.join(__dirname, '../dashboard');
if (!fs.existsSync(dashboardDir)) {
  fs.mkdirSync(dashboardDir, { recursive: true });
}

// Dashboard HTML content with real WebSocket integration
const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TCP-Serial Relay Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        .header h1 {
            color: #2c3e50;
            margin-bottom: 10px;
            font-size: 2em;
        }

        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.9em;
        }

        .status-healthy { background: #d4edda; color: #155724; }
        .status-warning { background: #fff3cd; color: #856404; }
        .status-error { background: #f8d7da; color: #721c24; }
        .status-unknown { background: #e2e3e5; color: #383d41; }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .dot-green { background: #28a745; }
        .dot-yellow { background: #ffc107; }
        .dot-red { background: #dc3545; }
        .dot-gray { background: #6c757d; }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .main-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
        }

        .card h2 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 1.3em;
            border-bottom: 2px solid #e9ecef;
            padding-bottom: 8px;
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
        }

        .metric {
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
            border-left: 4px solid #007bff;
        }

        .metric-value {
            font-size: 1.8em;
            font-weight: bold;
            color: #007bff;
            margin-bottom: 5px;
        }

        .metric-label {
            font-size: 0.85em;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .connection-status {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
        }

        .connection {
            flex: 1;
            margin: 0 10px;
            padding: 15px;
            border-radius: 10px;
            text-align: center;
        }

        .connection-tcp { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
        .connection-serial { background: linear-gradient(135deg, #f093fb, #f5576c); color: white; }

        .connection h3 {
            margin-bottom: 8px;
            font-size: 1.1em;
        }

        .connection-details {
            font-size: 0.9em;
            opacity: 0.9;
        }

        .full-width {
            grid-column: 1 / -1;
        }

        .tabs {
            display: flex;
            background: #f8f9fa;
            border-radius: 10px;
            padding: 5px;
            margin-bottom: 15px;
        }

        .tab {
            flex: 1;
            padding: 10px;
            text-align: center;
            border-radius: 7px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 600;
        }

        .tab.active {
            background: #007bff;
            color: white;
        }

        .tab:hover:not(.active) {
            background: #e9ecef;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .log-viewer {
            background: #1a1a1a;
            border-radius: 10px;
            padding: 15px;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.85em;
            line-height: 1.4;
        }

        .log-entry {
            margin-bottom: 5px;
            padding: 2px 0;
        }

        .log-timestamp { color: #6c757d; }
        .log-level-info { color: #17a2b8; }
        .log-level-warn { color: #ffc107; }
        .log-level-error { color: #dc3545; }
        .log-level-debug { color: #6f42c1; }
        .log-message { color: #e9ecef; }

        .config-form {
            display: grid;
            gap: 15px;
        }

        .form-group {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 10px;
            align-items: center;
        }

        .form-group label {
            font-weight: 600;
            color: #495057;
        }

        .form-group input, .form-group select {
            padding: 10px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 1em;
            transition: border-color 0.3s ease;
        }

        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: #007bff;
        }

        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .btn-primary {
            background: linear-gradient(135deg, #007bff, #0056b3);
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0, 123, 255, 0.3);
        }

        .btn-danger {
            background: linear-gradient(135deg, #dc3545, #c82333);
            color: white;
        }

        .btn-success {
            background: linear-gradient(135deg, #28a745, #1e7e34);
            color: white;
        }

        .btn-secondary {
            background: linear-gradient(135deg, #6c757d, #5a6268);
            color: white;
        }

        .action-buttons {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-top: 20px;
        }

        .alert {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 15px;
            font-weight: 500;
        }

        .alert-success { background: #d4edda; color: #155724; border-left: 4px solid #28a745; }
        .alert-error { background: #f8d7da; color: #721c24; border-left: 4px solid #dc3545; }
        .alert-info { background: #d1ecf1; color: #0c5460; border-left: 4px solid #17a2b8; }
        .alert-warning { background: #fff3cd; color: #856404; border-left: 4px solid #ffc107; }

        .connection-indicator {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.8em;
            font-weight: 600;
            z-index: 1000;
        }

        .connection-online { background: #d4edda; color: #155724; }
        .connection-offline { background: #f8d7da; color: #721c24; }

        @media (max-width: 768px) {
            .main-grid {
                grid-template-columns: 1fr;
            }
            
            .form-group {
                grid-template-columns: 1fr;
            }
            
            .connection-status {
                flex-direction: column;
            }
            
            .connection {
                margin: 5px 0;
            }
        }
    </style>
</head>
<body>
    <div class="connection-indicator" id="connection-indicator">
        <span>Connecting...</span>
    </div>

    <div class="container">
        <div class="header">
            <h1>TCP-Serial Relay Dashboard</h1>
            <div id="overall-status" class="status-indicator status-unknown">
                <div class="status-dot dot-gray"></div>
                <span>Connecting...</span>
            </div>
        </div>

        <div class="main-grid">
            <!-- Status Card -->
            <div class="card">
                <h2>System Status</h2>
                <div class="connection-status">
                    <div class="connection connection-tcp">
                        <h3>TCP Connection</h3>
                        <div class="connection-details" id="tcp-status">
                            <div>Status: <span id="tcp-connected">Unknown</span></div>
                            <div>Endpoint: <span id="tcp-endpoint">-</span></div>
                            <div>Bytes: <span id="tcp-bytes">-</span></div>
                        </div>
                    </div>
                    <div class="connection connection-serial">
                        <h3>Serial Connection</h3>
                        <div class="connection-details" id="serial-status">
                            <div>Status: <span id="serial-connected">Unknown</span></div>
                            <div>Port: <span id="serial-port">-</span></div>
                            <div>Bytes: <span id="serial-bytes">-</span></div>
                        </div>
                    </div>
                </div>
                <div id="status-message" class="alert alert-info">
                    Initializing connection...
                </div>
            </div>

            <!-- Metrics Card -->
            <div class="card">
                <h2>Performance Metrics</h2>
                <div class="metrics-grid">
                    <div class="metric">
                        <div class="metric-value" id="metric-uptime">0s</div>
                        <div class="metric-label">Uptime</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="metric-transfers">0</div>
                        <div class="metric-label">Data Transfers</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="metric-errors">0</div>
                        <div class="metric-label">Errors</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="metric-bytes">0 B</div>
                        <div class="metric-label">Total Bytes</div>
                    </div>
                </div>
            </div>

            <!-- Management Panel -->
            <div class="card full-width">
                <h2>Management Panel</h2>
                <div class="tabs">
                    <div class="tab active" onclick="switchTab('logs')">Live Logs</div>
                    <div class="tab" onclick="switchTab('config')">Configuration</div>
                    <div class="tab" onclick="switchTab('control')">Control</div>
                </div>

                <!-- Logs Tab -->
                <div id="tab-logs" class="tab-content active">
                    <div class="log-viewer" id="log-viewer">
                        <div class="log-entry">
                            <span class="log-timestamp">[${new Date().toLocaleTimeString()}]</span>
                            <span class="log-level-info">[INFO]</span>
                            <span class="log-message">Dashboard initialized</span>
                        </div>
                    </div>
                </div>

                <!-- Configuration Tab -->
                <div id="tab-config" class="tab-content">
                    <form class="config-form" id="config-form">
                        <div class="form-group">
                            <label for="tcp-ip">TCP IP:</label>
                            <input type="text" id="tcp-ip" name="tcpIp" placeholder="192.168.1.90">
                        </div>
                        <div class="form-group">
                            <label for="tcp-port">TCP Port:</label>
                            <input type="number" id="tcp-port" name="tcpPort" placeholder="10002">
                        </div>
                        <div class="form-group">
                            <label for="serial-path">Serial Path:</label>
                            <input type="text" id="serial-path" name="serialPath" placeholder="/dev/ttyUSB0">
                        </div>
                        <div class="form-group">
                            <label for="serial-baud">Baud Rate:</label>
                            <select id="serial-baud" name="serialBaud">
                                <option value="9600">9600</option>
                                <option value="19200">19200</option>
                                <option value="38400">38400</option>
                                <option value="57600">57600</option>
                                <option value="115200">115200</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="serial-parity">Parity:</label>
                            <select id="serial-parity" name="serialParity">
                                <option value="none">None</option>
                                <option value="even">Even</option>
                                <option value="odd">Odd</option>
                                <option value="mark">Mark</option>
                                <option value="space">Space</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="log-level">Log Level:</label>
                            <select id="log-level" name="logLevel">
                                <option value="error">Error</option>
                                <option value="warn">Warning</option>
                                <option value="info">Info</option>
                                <option value="debug">Debug</option>
                            </select>
                        </div>
                    </form>
                    <div class="action-buttons">
                        <button class="btn btn-primary" onclick="saveConfig()">Save Configuration</button>
                        <button class="btn btn-secondary" onclick="loadConfig()">Reload</button>
                        <button class="btn btn-secondary" onclick="loadPorts()">Refresh Ports</button>
                    </div>
                </div>

                <!-- Control Tab -->
                <div id="tab-control" class="tab-content">
                    <div class="action-buttons">
                        <button class="btn btn-success" onclick="startService()">Start Service</button>
                        <button class="btn btn-danger" onclick="stopService()">Stop Service</button>
                        <button class="btn btn-primary" onclick="restartService()">Restart Service</button>
                        <button class="btn btn-secondary" onclick="checkHealth()">Health Check</button>
                    </div>
                    <div id="control-output" class="log-viewer" style="margin-top: 20px; max-height: 200px;">
                        <div class="log-entry">
                            <span class="log-message">Ready for commands...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Dashboard JavaScript with real API integration
        let currentStatus = {
            overall: 'unknown',
            connections: {
                tcp: { connected: false, endpoint: '-', bytes: 0 },
                serial: { connected: false, port: '-', bytes: 0 }
            },
            metrics: {
                uptime: 0,
                dataTransfers: 0,
                errors: 0,
                totalBytes: 0
            },
            message: 'Initializing...'
        };

        let logs = [];
        let config = {};
        let ws = null;
        let reconnectTimer = null;

        // WebSocket connection management
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
            
            try {
                ws = new WebSocket(wsUrl);
                
                ws.onopen = function() {
                    console.log('WebSocket connected');
                    updateConnectionIndicator(true);
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                };
                
                ws.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);
                        handleWebSocketMessage(data);
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error);
                    }
                };
                
                ws.onclose = function() {
                    console.log('WebSocket disconnected');
                    updateConnectionIndicator(false);
                    // Attempt to reconnect after 5 seconds
                    reconnectTimer = setTimeout(() => {
                        connectWebSocket();
                    }, 5000);
                };
                
                ws.onerror = function(error) {
                    console.error('WebSocket error:', error);
                    updateConnectionIndicator(false);
                };
                
            } catch (error) {
                console.error('Failed to create WebSocket connection:', error);
                updateConnectionIndicator(false);
                // Retry connection after 5 seconds
                reconnectTimer = setTimeout(() => {
                    connectWebSocket();
                }, 5000);
            }
        }

        function updateConnectionIndicator(connected) {
            const indicator = document.getElementById('connection-indicator');
            if (connected) {
                indicator.className = 'connection-indicator connection-online';
                indicator.querySelector('span').textContent = 'Connected';
            } else {
                indicator.className = 'connection-indicator connection-offline';
                indicator.querySelector('span').textContent = 'Disconnected';
            }
        }

        function handleWebSocketMessage(data) {
            switch (data.type) {
                case 'status':
                    currentStatus = data.payload;
                    updateStatus();
                    break;
                case 'log':
                    addLog(data.payload.level, data.payload.message, data.payload.timestamp);
                    break;
                case 'config':
                    config = data.payload.config;
                    loadConfigToForm();
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        }

        // Tab switching
        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById(\`tab-\${tabName}\`).classList.add('active');
        }

        // Status updates
        function updateStatus() {
            // Update overall status
            const statusEl = document.getElementById('overall-status');
            statusEl.className = 'status-indicator';
            statusEl.querySelector('.status-dot').className = 'status-dot';
            
            let statusText = 'Unknown';
            let statusClass = 'status-unknown';
            let dotClass = 'dot-gray';
            
            if (currentStatus.success === true) {
                statusText = 'Healthy';
                statusClass = 'status-healthy';
                dotClass = 'dot-green';
            } else if (currentStatus.success === false) {
                statusText = 'Error';
                statusClass = 'status-error';
                dotClass = 'dot-red';
            } else if (currentStatus.connections && 
                      (currentStatus.connections.tcp?.connected || currentStatus.connections.serial?.connected)) {
                statusText = 'Warning';
                statusClass = 'status-warning';
                dotClass = 'dot-yellow';
            }
            
            statusEl.classList.add(statusClass);
            statusEl.querySelector('.status-dot').classList.add(dotClass);
            statusEl.querySelector('span').textContent = statusText;

            // Update connections
            if (currentStatus.connections) {
                const tcp = currentStatus.connections.tcp || {};
                const serial = currentStatus.connections.serial || {};
                
                document.getElementById('tcp-connected').textContent = tcp.connected ? 'Connected' : 'Disconnected';
                document.getElementById('tcp-endpoint').textContent = tcp.endpoint || \`\${config.tcpIp || '-'}:\${config.tcpPort || '-'}\`;
                document.getElementById('tcp-bytes').textContent = formatBytes(tcp.totalBytesReceived + tcp.totalBytesSent || 0);
                
                document.getElementById('serial-connected').textContent = serial.connected ? 'Connected' : 'Disconnected';
                document.getElementById('serial-port').textContent = serial.path || config.serialPath || '-';
                document.getElementById('serial-bytes').textContent = formatBytes(serial.totalBytesReceived + serial.totalBytesSent || 0);
            }

            // Update metrics
            if (currentStatus.metrics) {
                document.getElementById('metric-uptime').textContent = formatDuration(currentStatus.duration || 0);
                document.getElementById('metric-transfers').textContent = currentStatus.metrics.dataTransfers || 0;
                document.getElementById('metric-errors').textContent = currentStatus.metrics.errors || 0;
                
                const totalBytes = (currentStatus.metrics.bytesTransferredTcpToSerial || 0) + 
                                  (currentStatus.metrics.bytesTransferredSerialToTcp || 0);
                document.getElementById('metric-bytes').textContent = formatBytes(totalBytes);
            }

            // Update status message
            const messageEl = document.getElementById('status-message');
            messageEl.textContent = currentStatus.message || 'No status available';
            const messageClass = currentStatus.success === false ? 'alert-error' : 
                                currentStatus.success === true ? 'alert-success' : 'alert-info';
            messageEl.className = \`alert \${messageClass}\`;
        }

        // Utility functions
        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }

        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            if (hours > 0) return \`\${hours}h \${minutes % 60}m\`;
            if (minutes > 0) return \`\${minutes}m \${seconds % 60}s\`;
            return \`\${seconds}s\`;
        }

        // Logging
        function addLog(level, message, timestamp) {
            const logTimestamp = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
            const logEntry = { timestamp: logTimestamp, level, message };
            logs.push(logEntry);
            
            // Keep only last 100 logs
            if (logs.length > 100) {
                logs = logs.slice(-100);
            }
            
            updateLogViewer();
        }

        function updateLogViewer() {
            const logViewer = document.getElementById('log-viewer');
            logViewer.innerHTML = logs.map(log => \`
                <div class="log-entry">
                    <span class="log-timestamp">[\${log.timestamp}]</span>
                    <span class="log-level-\${log.level}">[\${log.level.toUpperCase()}]</span>
                    <span class="log-message">\${log.message}</span>
                </div>
            \`).join('');
            
            logViewer.scrollTop = logViewer.scrollHeight;
        }

        // API functions
        async function apiCall(endpoint, method = 'GET', data = null) {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };
            
            if (data) {
                options.body = JSON.stringify(data);
            }
            
            try {
                const response = await fetch(\`/api\${endpoint}\`, options);
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                return await response.json();
            } catch (error) {
                console.error('API call failed:', error);
                addLog('error', \`API call failed: \${error.message}\`);
                throw error;
            }
        }

        // Configuration management
        async function loadConfig() {
            try {
                const response = await apiCall('/config');
                config = response.config || {};
                loadConfigToForm();
                addLog('info', 'Configuration loaded');
            } catch (error) {
                addLog('error', 'Failed to load configuration');
            }
        }

        function loadConfigToForm() {
            if (config.tcpIp) document.getElementById('tcp-ip').value = config.tcpIp;
            if (config.tcpPort) document.getElementById('tcp-port').value = config.tcpPort;
            if (config.serialPath) document.getElementById('serial-path').value = config.serialPath;
            if (config.serialBaud) document.getElementById('serial-baud').value = config.serialBaud;
            if (config.serialParity) document.getElementById('serial-parity').value = config.serialParity;
            if (config.logLevel) document.getElementById('log-level').value = config.logLevel;
        }

        async function saveConfig() {
            try {
                const newConfig = {
                    tcpIp: document.getElementById('tcp-ip').value,
                    tcpPort: parseInt(document.getElementById('tcp-port').value),
                    serialPath: document.getElementById('serial-path').value,
                    serialBaud: parseInt(document.getElementById('serial-baud').value),
                    serialParity: document.getElementById('serial-parity').value,
                    logLevel: document.getElementById('log-level').value
                };
                
                await apiCall('/config', 'POST', newConfig);
                config = newConfig;
                addLog('info', 'Configuration saved successfully');
                updateStatus(); // Update display with new config
            } catch (error) {
                addLog('error', 'Failed to save configuration');
            }
        }

        async function loadPorts() {
            try {
                const response = await apiCall('/ports');
                const serialPathInput = document.getElementById('serial-path');
                
                if (response.ports && response.ports.length > 0) {
                    // Create or update datalist for serial path suggestions
                    let datalist = document.getElementById('serial-ports-list');
                    if (!datalist) {
                        datalist = document.createElement('datalist');
                        datalist.id = 'serial-ports-list';
                        serialPathInput.parentNode.appendChild(datalist);
                        serialPathInput.setAttribute('list', 'serial-ports-list');
                    }
                    
                    datalist.innerHTML = response.ports.map(port => 
                        \`<option value="\${port.path}">\${port.path} - \${port.manufacturer || 'Unknown'}</option>\`
                    ).join('');
                    
                    addLog('info', \`Found \${response.ports.length} serial port(s)\`);
                } else {
                    addLog('warn', 'No serial ports found');
                }
            } catch (error) {
                addLog('error', 'Failed to load serial ports');
            }
        }

        // Service control
        async function startService() {
            try {
                await apiCall('/control/start', 'POST');
                addLog('info', 'Start command sent');
            } catch (error) {
                addLog('error', 'Failed to start service');
            }
        }

        async function stopService() {
            try {
                await apiCall('/control/stop', 'POST');
                addLog('info', 'Stop command sent');
            } catch (error) {
                addLog('error', 'Failed to stop service');
            }
        }

        async function restartService() {
            try {
                await apiCall('/control/restart', 'POST');
                addLog('info', 'Restart command sent');
            } catch (error) {
                addLog('error', 'Failed to restart service');
            }
        }

        async function checkHealth() {
            try {
                const health = await apiCall('/health');
                const controlOutput = document.getElementById('control-output');
                controlOutput.innerHTML = \`
                    <div class="log-entry"><span class="log-message">Health Check Results:</span></div>
                    <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Overall Status: \${health.status}</span></div>
                    <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Uptime: \${formatDuration(health.uptime || 0)}</span></div>
                    \${health.connections ? Object.entries(health.connections).map(([key, conn]) => 
                        \`<div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">\${key.toUpperCase()} Connection: \${conn.connected ? 'OK' : 'FAILED'}</span></div>\`
                    ).join('') : ''}
                    \${health.metrics ? \`
                        <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Data Transfers: \${health.metrics.dataTransfers || 0}</span></div>
                        <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Error Count: \${health.metrics.errors || 0}</span></div>
                    \` : ''}
                    <div class="log-entry"><span class="log-level-info">[INFO]</span> <span class="log-message">Health check completed</span></div>
                \`;
                addLog('info', \`Health check completed - Status: \${health.status}\`);
            } catch (error) {
                addLog('error', 'Health check failed');
            }
        }

        // Initialize dashboard
        async function init() {
            addLog('info', 'Dashboard initializing...');
            
            // Connect WebSocket
            connectWebSocket();
            
            // Load initial data
            try {
                await loadConfig();
                const statusResponse = await apiCall('/status');
                if (statusResponse.status) {
                    currentStatus = statusResponse.status;
                    updateStatus();
                }
            } catch (error) {
                addLog('warn', 'Failed to load initial data');
            }
            
            addLog('info', 'Dashboard initialized');
        }

        // Start the dashboard when page loads
        document.addEventListener('DOMContentLoaded', init);

        // Handle page visibility changes to reconnect WebSocket
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
                addLog('info', 'Page became visible, reconnecting...');
                connectWebSocket();
            }
        });
    </script>
</body>
</html>`;

// Write the dashboard file
const indexPath = path.join(dashboardDir, 'index.html');
fs.writeFileSync(indexPath, dashboardHtml, 'utf8');

console.log('✅ Dashboard HTML created at:', indexPath);

// Create a simple CSS file for any additional styles
const cssContent = `/* Additional dashboard styles can be added here */
.custom-styles {
    /* Future enhancements */
}`;

const cssPath = path.join(dashboardDir, 'dashboard.css');
fs.writeFileSync(cssPath, cssContent, 'utf8');

console.log('✅ Dashboard CSS created at:', cssPath);

// Create a configuration file for the dashboard
const dashboardConfig = {
    name: "TCP-Serial Relay Dashboard",
    version: "1.1.0",
    description: "Web-based monitoring and control interface",
    defaultPort: 3000,
    features: [
        "Real-time status monitoring",
        "Live log streaming",
        "Configuration management",
        "Service control",
        "Health monitoring"
    ],
    apiEndpoints: {
        status: "/api/status",
        config: "/api/config",
        logs: "/api/logs",
        health: "/api/health",
        control: "/api/control/*",
        ports: "/api/ports"
    }
};

const configPath = path.join(dashboardDir, 'dashboard-config.json');
fs.writeFileSync(configPath, JSON.stringify(dashboardConfig, null, 2), 'utf8');

console.log('✅ Dashboard configuration created at:', configPath);

console.log('\n🎉 Dashboard build completed successfully!');
console.log('\nTo start the dashboard:');
console.log('  npm run start:dashboard');
console.log('\nTo start with full relay service:');
console.log('  npm run start:with-dashboard');
console.log('\nDashboard will be available at: http://localhost:3000');