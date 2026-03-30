import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.test if it exists
function loadTestEnv() {
  const envTestPath = path.join(__dirname, '.env.test');
  if (fs.existsSync(envTestPath)) {
    const envContent = fs.readFileSync(envTestPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          process.env[key.trim()] = value.trim();
        }
      }
    });
  }
}

loadTestEnv();

// Set JWT_SECRET globally for test files that import src/lib/auth.ts directly
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jwt-signing-at-least-32-chars';

// Check if we're running auth tests specifically
const isAuthTest = process.argv.some(arg => arg.includes('auth.spec'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 5,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
      // Skip auth tests unless explicitly running them with AUTH_PASSWORD
      testIgnore: isAuthTest ? undefined : /auth\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev:test -- -p 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    env: {
      ...(process.env.GOOGLE_API_KEY ? { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY } : {}),
      ...(process.env.GEMINI_MODEL ? { GEMINI_MODEL: process.env.GEMINI_MODEL } : {}),
      // Set JWT_SECRET for tests
      JWT_SECRET: 'test-secret-for-jwt-signing-at-least-32-chars',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
