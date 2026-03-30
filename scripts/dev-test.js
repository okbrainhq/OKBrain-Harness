#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Check if .env.local exists, if not create it with JWT_SECRET
const envPath = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  const jwtSecret = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(envPath, `JWT_SECRET=${jwtSecret}\n`);
  console.log('✓ Created .env.local with JWT_SECRET');
}

// Set test environment variables BEFORE anything else
const testDbPath = path.resolve(process.cwd(), 'brain.test.db');
process.env.TEST_DB_PATH = testDbPath;
process.env.TEST_MODE = 'true';
// Note: Next.js will override NODE_ENV to 'development', but TEST_DB_PATH takes precedence

console.log(`[TEST] ========================================`);
console.log(`[TEST] Starting Next.js in TEST MODE`);
console.log(`[TEST] Test database path: ${testDbPath}`);
console.log(`[TEST] TEST_DB_PATH=${process.env.TEST_DB_PATH}`);
console.log(`[TEST] TEST_MODE=${process.env.TEST_MODE}`);
console.log(`[TEST] NODE_ENV=${process.env.NODE_ENV || 'undefined'}`);
console.log(`[TEST] ========================================`);

// Verify the test database path is absolute
if (!path.isAbsolute(testDbPath)) {
  console.error(`[TEST] ERROR: Test database path is not absolute: ${testDbPath}`);
  process.exit(1);
}

// Spawn Next.js dev server with ALL environment variables (including our test vars)
const nextDev = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env, // Spread all current env vars including our TEST_DB_PATH
  },
});

nextDev.on('error', (error) => {
  console.error(`[TEST] Failed to start Next.js:`, error);
  process.exit(1);
});

nextDev.on('exit', (code) => {
  process.exit(code || 0);
});

