#!/usr/bin/env node

// scripts/create-update-job.js
// Script to create AWS IoT Jobs for software updates

const AWS = require('aws-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configure AWS
const iot = new AWS.Iot({
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Create a software update job
 */
async function createUpdateJob(options) {
  const {
    jobId,
    targets,
    version,
    downloadUrl,
    checksum,
    description = `Software update to version ${version}`,
    rollback = true
  } = options;

  const jobDocument = {
    operation: 'software_update',
    version,
    downloadUrl,
    checksum,
    restartRequired: true,
    rollbackEnabled: rollback,
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'update-script'
    }
  };

  const jobParams = {
    jobId,
    targets,
    description,
    document: JSON.stringify(jobDocument),
    presignedUrlConfig: {
      roleArn: process.env.AWS_IOT_ROLE_ARN,
      expiresInSec: 3600 // 1 hour
    },
    jobExecutionsRolloutConfig: {
      maximumPerMinute: 5,
      exponentialRate: {
        baseRatePerMinute: 5,
        incrementFactor: 2,
        rateIncreaseCriteria: {
          numberOfNotifiedThings: 10,
          numberOfSucceededThings: 5
        }
      }
    },
    abortConfig: {
      criteriaList: [
        {
          failureType: 'FAILED',
          action: 'CANCEL',
          thresholdPercentage: 20,
          minNumberOfExecutedThings: 1
        }
      ]
    },
    timeoutConfig: {
      inProgressTimeoutInMinutes: 60
    }
  };

  try {
    const result = await iot.createJob(jobParams).promise();
    console.log('Job created successfully:', result);
    return result;
  } catch (error) {
    console.error('Failed to create job:', error);
    throw error;
  }
}

/**
 * Calculate checksum of a file
 */
function calculateChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return `sha256:${hash.digest('hex')}`;
}

/**
 * List all things (devices) in your AWS IoT fleet
 */
async function listThings() {
  try {
    const result = await iot.listThings({}).promise();
    return result.things.map(thing => `arn:aws:iot:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:thing/${thing.thingName}`);
  } catch (error) {
    console.error('Failed to list things:', error);
    return [];
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log(`
Usage: node create-update-job.js <version> <download-url> <package-file> [thing-name]

Examples:
  # Update all devices
  node create-update-job.js 1.3.0 https://releases.example.com/tcp-relay-1.3.0.tar.gz ./release.tar.gz

  # Update specific device
  node create-update-job.js 1.3.0 https://releases.example.com/tcp-relay-1.3.0.tar.gz ./release.tar.gz my-device-mac-address

Environment variables required:
  AWS_REGION - AWS region (e.g., us-east-1)
  AWS_ACCOUNT_ID - Your AWS account ID
  AWS_IOT_ROLE_ARN - IAM role ARN for presigned URLs
    `);
    process.exit(1);
  }

  const [version, downloadUrl, packageFile, specificThing] = args;

  try {
    // Calculate checksum of the package file
    console.log('Calculating package checksum...');
    const checksum = calculateChecksum(packageFile);
    console.log(`Package checksum: ${checksum}`);

    // Determine targets
    let targets;
    if (specificThing) {
      targets = [`arn:aws:iot:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:thing/${specificThing}`];
    } else {
      console.log('Getting list of all devices...');
      targets = await listThings();
      console.log(`Found ${targets.length} devices`);
    }

    if (targets.length === 0) {
      console.error('No targets found. Make sure devices are registered in AWS IoT.');
      process.exit(1);
    }

    // Create job ID
    const jobId = `software-update-${version}-${Date.now()}`;

    console.log(`Creating update job: ${jobId}`);
    console.log(`Target version: ${version}`);
    console.log(`Download URL: ${downloadUrl}`);
    console.log(`Targets: ${targets.length} device(s)`);

    await createUpdateJob({
      jobId,
      targets,
      version,
      downloadUrl,
      checksum,
      description: `Software update to version ${version}`,
      rollback: true
    });

    console.log('\n✅ Update job created successfully!');
    console.log(`Job ID: ${jobId}`);
    console.log('\nMonitor job progress in AWS IoT Console or via CLI:');
    console.log(`aws iot describe-job --job-id ${jobId}`);

  } catch (error) {
    console.error('❌ Failed to create update job:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  createUpdateJob,
  calculateChecksum,
  listThings
};