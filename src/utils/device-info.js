// src/utils/device-info.js
const os = require('os');

/**
 * Get the first available MAC address from network interfaces
 * @returns {string|null} MAC address without colons or null if not found
 */
function getMacAddress() {
  const interfaces = os.networkInterfaces();
  
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      // Skip loopback, internal interfaces, and zero MAC addresses
      if (!iface.internal && 
          (iface.family === 'IPv4' || iface.family === 'IPv6') && 
          iface.mac && 
          iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.replace(/:/g, '');
      }
    }
  }
  
  return null;
}

/**
 * Get device ID based on MAC address
 * @returns {string} Device ID (MAC address without colons) or 'unknown'
 */
function getDeviceId() {
  const macAddress = getMacAddress();
  return macAddress || 'unknown';
}

/**
 * Get comprehensive device information
 * @returns {object} Device information object
 */
function getDeviceInfo() {
  return {
    deviceId: getDeviceId(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    type: os.type(),
    uptime: os.uptime(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    loadAverage: os.loadavg(),
    networkInterfaces: Object.keys(os.networkInterfaces())
  };
}

module.exports = {
  getMacAddress,
  getDeviceId,
  getDeviceInfo
};