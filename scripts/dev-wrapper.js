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

// Now run the actual next dev command using npx for cross-platform support
const nextDev = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
});

nextDev.on('error', (error) => {
  console.error('Failed to start Next.js:', error);
  process.exit(1);
});

nextDev.on('exit', (code) => {
  process.exit(code || 0);
});
