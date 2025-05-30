const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const https = require('https');
const os = require('os');

// Function to check and update a global npm package
async function checkAndUpdatePackage(packageName) {
  try {
    console.log(`Checking for updates to ${packageName}...`);

    // Check for outdated global packages
    let stdout;
    try {
      const result = await execPromise('npm outdated -g --json');
      stdout = result.stdout;
    } catch (error) {
      // npm outdated returns exit code 1 when packages are outdated, but we still want the output
      if (error.code === 1 && error.stdout) {
        stdout = error.stdout;
      } else {
        throw error; // Rethrow if it's a different error
      }
    }

    const outdated = JSON.parse(stdout || '{}');

    if (outdated[packageName]) {
      const currentVersion = outdated[packageName].current;
      const latestVersion = outdated[packageName].latest;

      console.log(`${packageName} is outdated. Current: ${currentVersion}, Latest: ${latestVersion}`);

      // Update the package
      console.log(`Updating ${packageName} to version ${latestVersion}...`);
      await execPromise(`npm install -g ${packageName}@${latestVersion}`);
      console.log(`${packageName} successfully updated to version ${latestVersion}`);
      
      // Send update information to the endpoint
      const deviceId = os.hostname();
      await reportVersionUpdate(deviceId, latestVersion);
    } else {
      console.log(`${packageName} is already up to date or not installed globally.`);
    }
  } catch (error) {
    console.error(`Error processing ${packageName}:`, error.message);
  }
}

// Main function to handle command-line argument
async function main() {
  const packageName = "tcp-serial-relay";

  if (!packageName) {
    console.error('Please provide a package name. Usage: node update-global-package.js <package-name>');
    process.exit(1);
  }

  await checkAndUpdatePackage(packageName);
}

// Function to report version update to the endpoint
async function reportVersionUpdate(deviceId, version) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ deviceId, version });
    
    const options = {
      hostname: 'version-2lbtz4kjxa-uc.a.run.app',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        console.log(`Version update reported to server. Status: ${res.statusCode}`);
        resolve(responseData);
      });
    });
    
    req.on('error', (error) => {
      console.error('Error reporting version update:', error.message);
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

// Run the script
main();