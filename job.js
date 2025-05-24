// job.js - Legacy entry point for backward compatibility
// This file maintains the original interface while using the new modular structure

const { main } = require('./src/app');

// Run the main application
main().catch((error) => {
  console.error('Fatal application error:', error);
  process.exit(1);
});