// Global variables
let statusUpdateInterval;
let logsUpdateInterval;
let currentConfig = {};

// DOM elements
const statusIndicator = document.getElementById('status-indicator');
const tcpStatus = document.getElementById('tcp-status');
const serialStatus = document.getElementById('serial-status');
const cpuUsage = document.getElementById('cpu-usage');
const memoryUsage = document.getElementById('memory-usage');
const uptime = document.getElementById('uptime');
const configForm = document.getElementById('config-form');
const logEntries = document.getElementById('log-entries');
const logLines = document.getElementById('log-lines');
const tabs = document.querySelectorAll('nav a');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
  // Set up tab navigation
  setupTabs();
  
  // Load initial data
  fetchStatus();
  fetchConfig();
  fetchLogs();
  
  // Set up event listeners
  document.getElementById('start-service').addEventListener('click', () => controlService('start'));
  document.getElementById('stop-service').addEventListener('click', () => controlService('stop'));
  document.getElementById('restart-service').addEventListener('click', () => controlService('restart'));
  document.getElementById('refresh-logs').addEventListener('click', fetchLogs);
  configForm.addEventListener('submit', saveConfig);
  document.getElementById('reset-config').addEventListener('click', resetConfigForm);
  
  // Set up polling
  statusUpdateInterval = setInterval(fetchStatus, 5000);
  logsUpdateInterval = setInterval(fetchLogs, 10000);
});

// Tab navigation
function setupTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = tab.getAttribute('data-tab');
      
      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Show active content
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabId}-tab`) {
          content.classList.add('active');
        }
      });
    });
  });
}

// Format time duration
function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = Math.floor(seconds % 60);
  
  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  result += `${seconds}s`;
  
  return result;
}

// Fetch status data
async function fetchStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    
    // Update status indicator
    statusIndicator.textContent = data.overall;
    statusIndicator.className = `status-${data.overall.toLowerCase()}`;
    
    // Update connection status
    tcpStatus.textContent = data.connections.tcp.connected ? 'Connected' : 'Disconnected';
    tcpStatus.className = `status-indicator ${data.connections.tcp.connected ? 'connected' : 'disconnected'}`;
    
    serialStatus.textContent = data.connections.serial.connected ? 'Connected' : 'Disconnected';
    serialStatus.className = `status-indicator ${data.connections.serial.connected ? 'connected' : 'disconnected'}`;
    
    // Update metrics
    if (data.systemMetrics) {
      cpuUsage.textContent = `${data.systemMetrics.cpuUsage.toFixed(1)}%`;
      const memUsagePercent = 100 - (data.systemMetrics.freeMemory / data.systemMetrics.totalMemory * 100);
      memoryUsage.textContent = `${memUsagePercent.toFixed(1)}%`;
      uptime.textContent = formatDuration(data.systemMetrics.uptime);
    }
  } catch (error) {
    console.error('Error fetching status:', error);
  }
}

// Fetch configuration
async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    currentConfig = await response.json();
    
    // Populate form fields
    for (const [key, value] of Object.entries(currentConfig)) {
      const field = document.getElementById(key);
      if (field) {
        if (field.type === 'checkbox') {
          field.checked = value;
        } else {
          field.value = value;
        }
      }
    }
  } catch (error) {
    console.error('Error fetching config:', error);
  }
}

// Save configuration
async function saveConfig(e) {
  e.preventDefault();
  
  const formData = new FormData(configForm);
  const newConfig = {};
  
  // Process form data
  for (const [key, value] of formData.entries()) {
    if (document.getElementById(key).type === 'checkbox') {
      newConfig[key] = document.getElementById(key).checked;
    } else if (document.getElementById(key).type === 'number') {
      newConfig[key] = Number(value);
    } else {
      newConfig[key] = value;
    }
  }
  
  try {
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newConfig)
    });
    
    const result = await response.json();
    
    if (result.success) {
      alert('Configuration saved successfully');
      currentConfig = newConfig;
    } else {
      alert('Failed to save configuration');
    }
  } catch (error) {
    console.error('Error saving config:', error);
    alert('Error saving configuration');
  }
}

// Reset config form
function resetConfigForm() {
  fetchConfig();
}

// Fetch logs
async function fetchLogs() {
  try {
    const lines = logLines.value;
    const response = await fetch(`/api/logs?lines=${lines}`);
    const logs = await response.json();
    
    // Clear existing logs
    logEntries.innerHTML = '';
    
    // Add new logs
    logs.forEach(log => {
      const row = document.createElement('tr');
      row.className = `log-level-${log.level.toLowerCase()}`;
      
      const timestamp = document.createElement('td');
      timestamp.textContent = new Date(log.timestamp).toLocaleString();
      
      const level = document.createElement('td');
      level.textContent = log.level;
      
      const message = document.createElement('td');
      message.textContent = log.message;
      
      row.appendChild(timestamp);
      row.appendChild(level);
      row.appendChild(message);
      
      logEntries.appendChild(row);
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
  }
}

// Control service
async function controlService(action) {
  try {
    const response = await fetch('/api/service', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action })
    });
    
    const result = await response.json();
    
    if (result.success) {
      alert(result.message);
      // Refresh status immediately
      fetchStatus();
    } else {
      alert(`Failed to ${action} service`);
    }
  } catch (error) {
    console.error(`Error ${action}ing service:`, error);
    alert(`Error ${action}ing service`);
  }
}

// Clean up intervals when page is closed
window.addEventListener('beforeunload', () => {
  clearInterval(statusUpdateInterval);
  clearInterval(logsUpdateInterval);
});