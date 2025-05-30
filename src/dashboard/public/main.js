// Fixed main.js for src/dashboard/public/main.js
let currentStatus = {};
let currentConfig = {};
let statusUpdateInterval;
let logsUpdateInterval;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    setupTabs();
    loadInitialData();
    setupEventListeners();
    startStatusUpdates();
});

// Tab management
function setupTabs() {
    const tabs = document.querySelectorAll('.nav a[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const targetTab = this.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Show target content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetTab + '-tab') {
                    content.classList.add('active');
                }
            });
        });
    });
}

// Event listeners
function setupEventListeners() {
    // Configuration form
    const configForm = document.getElementById('config-form');
    if (configForm) {
        configForm.addEventListener('submit', saveConfig);
        
        // Connection type change handler
        const connectionType = document.getElementById('connectionType');
        if (connectionType) {
            connectionType.addEventListener('change', toggleConnectionSections);
        }
    }
}

// Load initial data
async function loadInitialData() {
    await Promise.all([
        fetchStatus(),
        loadConfig(),
        refreshLogs()
    ]);
}

// Start periodic status updates
function startStatusUpdates() {
    statusUpdateInterval = setInterval(fetchStatus, 5000);
    logsUpdateInterval = setInterval(refreshLogs, 30000); // Refresh logs every 30 seconds
}

// API Functions
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch('/api' + endpoint, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Status management
async function fetchStatus() {
    try {
        const data = await apiCall('/status');
        // Handle the API response structure: { status: {...} }
        currentStatus = data.status || data;
        updateStatusDisplay();
    } catch (error) {
        console.error('Failed to fetch status:', error);
        showConnectionError();
    }
}

function updateStatusDisplay() {
    // Safely get overall status with fallback
    const overallStatus = currentStatus.overall || 'unknown';
    
    // Update connection status indicator
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = overallStatus;
    }
    
    // Update overall status
    const overallStatusEl = document.getElementById('overall-status');
    if (overallStatusEl) {
        overallStatusEl.textContent = overallStatus;
        overallStatusEl.className = 'status-indicator ' + overallStatus.toLowerCase();
    }
    
    // Update status message
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
        statusMessage.textContent = currentStatus.message || 'No status available';
    }
    
    // Update connection statuses
    updateConnectionStatus('tcp-status', currentStatus.connections?.tcp);
    updateConnectionStatus('secondary-status', currentStatus.connections?.secondary);
    
    // Update metrics
    updateMetrics();
}

function updateConnectionStatus(elementId, connection) {
    const element = document.getElementById(elementId);
    if (element) {
        if (connection && typeof connection === 'object') {
            const isConnected = connection.connected;
            element.textContent = isConnected ? 'Connected' : 'Disconnected';
            element.className = 'status-badge ' + (isConnected ? 'connected' : 'disconnected');
        } else {
            element.textContent = 'Unknown';
            element.className = 'status-badge unknown';
        }
    }
}

function updateMetrics() {
    // Uptime
    const uptimeEl = document.getElementById('uptime');
    if (uptimeEl && currentStatus.systemMetrics) {
        uptimeEl.textContent = formatDuration(currentStatus.systemMetrics.uptime || 0);
    }
    
    // Memory usage
    const memoryEl = document.getElementById('memory');
    if (memoryEl && currentStatus.systemMetrics && currentStatus.systemMetrics.totalMemory) {
        const memUsage = 100 - (currentStatus.systemMetrics.freeMemory / currentStatus.systemMetrics.totalMemory * 100);
        memoryEl.textContent = memUsage.toFixed(1) + '%';
    }
    
    // Data transfers
    const transfersEl = document.getElementById('transfers');
    if (transfersEl) {
        transfersEl.textContent = currentStatus.metrics?.dataTransfers || 0;
    }
    
    // Errors
    const errorsEl = document.getElementById('errors');
    if (errorsEl) {
        errorsEl.textContent = currentStatus.metrics?.errors || 0;
    }
}

function showConnectionError() {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = 'Connection Error';
    }
    
    const overallStatusEl = document.getElementById('overall-status');
    if (overallStatusEl) {
        overallStatusEl.textContent = 'Error';
        overallStatusEl.className = 'status-indicator error';
    }
}

// Configuration management
async function loadConfig() {
    try {
        const data = await apiCall('/config');
        // Handle the API response structure: { config: {...} }
        currentConfig = data.config || data || {};
        populateConfigForm();
    } catch (error) {
        console.error('Failed to load config:', error);
        showNotification('Failed to load configuration', 'error');
    }
}

function populateConfigForm() {
    Object.keys(currentConfig).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = currentConfig[key];
            } else {
                element.value = currentConfig[key] || '';
            }
        }
    });
    
    // Update connection type sections
    toggleConnectionSections();
}

async function saveConfig(e) {
    e.preventDefault();
    
    try {
        const formData = new FormData(e.target);
        const newConfig = {};
        
        for (const [key, value] of formData.entries()) {
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    newConfig[key] = element.checked;
                } else if (element.type === 'number') {
                    newConfig[key] = parseInt(value) || 0;
                } else {
                    newConfig[key] = value;
                }
            }
        }
        
        await apiCall('/config', {
            method: 'POST',
            body: JSON.stringify(newConfig)
        });
        
        currentConfig = newConfig;
        showNotification('Configuration saved successfully', 'success');
        
    } catch (error) {
        console.error('Failed to save config:', error);
        showNotification('Failed to save configuration', 'error');
    }
}

function toggleConnectionSections() {
    const connectionType = document.getElementById('connectionType');
    const serialSection = document.getElementById('serial-section');
    const tcpSection = document.getElementById('tcp-section');
    
    if (connectionType && serialSection && tcpSection) {
        if (connectionType.value === 'tcp') {
            serialSection.style.display = 'none';
            tcpSection.style.display = 'block';
        } else {
            serialSection.style.display = 'block';
            tcpSection.style.display = 'none';
        }
    }
}

async function refreshPorts() {
    try {
        const data = await apiCall('/ports');
        const serialPath = document.getElementById('serialPath');
        
        if (serialPath && data.ports && Array.isArray(data.ports)) {
            // Create datalist for autocomplete
            let datalist = document.getElementById('serial-ports-datalist');
            if (!datalist) {
                datalist = document.createElement('datalist');
                datalist.id = 'serial-ports-datalist';
                serialPath.parentNode.appendChild(datalist);
                serialPath.setAttribute('list', 'serial-ports-datalist');
            }
            
            datalist.innerHTML = data.ports.map(port => 
                `<option value="${port.path}">${port.path} - ${port.manufacturer || 'Unknown'}</option>`
            ).join('');
            
            showNotification(`Found ${data.ports.length} serial port(s)`, 'success');
        } else {
            showNotification('No serial ports found', 'warning');
        }
    } catch (error) {
        console.error('Failed to refresh ports:', error);
        showNotification('Failed to refresh serial ports', 'error');
    }
}

// Logs management
async function refreshLogs() {
    try {
        const lines = document.getElementById('log-lines')?.value || 50;
        const data = await apiCall(`/logs?lines=${lines}`);
        
        const logsContent = document.getElementById('logs-content');
        if (logsContent) {
            // Handle the API response structure: { logs: [...] }
            const logs = data.logs || data || [];
            
            if (Array.isArray(logs) && logs.length > 0) {
                logsContent.innerHTML = logs.map(log => 
                    `<div class="log-entry">
                        <span class="log-timestamp">[${formatTimestamp(log.timestamp)}]</span>
                        <span class="log-level ${log.level}">[${(log.level || 'info').toUpperCase()}]</span>
                        <span class="log-message">${escapeHtml(log.message || '')}</span>
                    </div>`
                ).join('');
            } else {
                logsContent.innerHTML = '<div class="log-entry"><span class="log-message">No logs available</span></div>';
            }
            
            // Scroll to bottom
            logsContent.scrollTop = logsContent.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to refresh logs:', error);
        const logsContent = document.getElementById('logs-content');
        if (logsContent) {
            logsContent.innerHTML = '<div class="log-entry"><span class="log-message">Error loading logs: ' + error.message + '</span></div>';
        }
    }
}

// Service control
async function controlService(action) {
    try {
        const data = await apiCall(`/control/${action}`, { method: 'POST' });
        showNotification(data.message || `${action} command sent`, 'success');
        
        const controlResults = document.getElementById('control-results');
        if (controlResults) {
            const timestamp = new Date().toLocaleTimeString();
            controlResults.innerHTML += `<div>[${timestamp}] ${data.message || action + ' command sent'}</div>`;
            controlResults.scrollTop = controlResults.scrollHeight;
        }
        
        // Refresh status after control action
        setTimeout(fetchStatus, 1000);
        
    } catch (error) {
        console.error(`Failed to ${action} service:`, error);
        showNotification(`Failed to ${action} service`, 'error');
    }
}

async function checkHealth() {
    try {
        const data = await apiCall('/health');
        
        const controlResults = document.getElementById('control-results');
        if (controlResults) {
            const timestamp = new Date().toLocaleTimeString();
            const healthInfo = `Health Status: ${data.status || 'unknown'}
Uptime: ${formatDuration((data.uptime || 0) / 1000)}
Dashboard Port: ${data.dashboardServer?.port || 'Unknown'}`;
            
            controlResults.innerHTML += `<div>[${timestamp}] Health Check:</div><pre>${healthInfo}</pre>`;
            controlResults.scrollTop = controlResults.scrollHeight;
        }
        
        showNotification(`Health check completed - Status: ${data.status || 'unknown'}`, 'success');
        
    } catch (error) {
        console.error('Health check failed:', error);
        showNotification('Health check failed', 'error');
    }
}

// Utility functions
function formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function formatTimestamp(timestamp) {
    try {
        if (!timestamp) return new Date().toLocaleTimeString();
        return new Date(timestamp).toLocaleTimeString();
    } catch {
        return timestamp || '';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 20px',
        borderRadius: '6px',
        color: 'white',
        fontWeight: '500',
        zIndex: '9999',
        minWidth: '250px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        animation: 'slideInRight 0.3s ease-out'
    });
    
    // Set background color based on type
    const colors = {
        success: '#27ae60',
        error: '#e74c3c',
        warning: '#f39c12',
        info: '#3498db'
    };
    notification.style.backgroundColor = colors[type] || colors.info;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Remove after 4 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// Add CSS for notifications
const notificationCSS = `
@keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

@keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
}
`;

const style = document.createElement('style');
style.textContent = notificationCSS;
document.head.appendChild(style);

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (statusUpdateInterval) {
        clearInterval(statusUpdateInterval);
    }
    if (logsUpdateInterval) {
        clearInterval(logsUpdateInterval);
    }
});