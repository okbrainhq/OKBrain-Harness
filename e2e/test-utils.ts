import { execSync } from 'child_process';
import { expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createUser } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { v4 as uuidv4 } from 'uuid';

// Load test environment variables from .env.test if it exists
export function loadTestEnv() {
  const envTestPath = path.join(process.cwd(), '.env.test');
  if (fs.existsSync(envTestPath)) {
    const envContent = fs.readFileSync(envTestPath, 'utf-8');
    const envVars: Record<string, string> = {};

    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          envVars[key.trim()] = value.trim();
        }
      }
    });

    // Set environment variables
    Object.entries(envVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
  }
}

// Clean up test database
export function cleanupTestDb() {
  const testDbPath = path.join(process.cwd(), 'brain.test.db');

  // If DB doesn't exist, we don't need to do anything (it will be created by app or setupTestUser)
  if (!fs.existsSync(testDbPath)) {
    return;
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(testDbPath);

    // Disable foreign keys to allow clearing order
    db.exec('PRAGMA foreign_keys = OFF');

    // Clear all tables
    db.exec('DELETE FROM document_snapshots');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM documents');
    db.exec('DELETE FROM conversations');
    db.exec('DELETE FROM folders');
    db.exec('DELETE FROM events');
    db.exec('DELETE FROM users');
    db.exec('DELETE FROM file_attachments');
    db.exec('DELETE FROM fact_extractions');
    db.exec('DELETE FROM facts');
    db.exec('DELETE FROM fact_sheets');
    db.exec('DELETE FROM chat_yield_sessions');
    db.exec('DELETE FROM tool_call_logs');
    db.exec('DELETE FROM conversation_tool_jobs');
    try { db.exec('DELETE FROM file_browsers'); } catch { }
    try { db.exec('DELETE FROM chat_events'); } catch { }
    // fact_vec is a sqlite-vec virtual table — only exists if extension is loaded
    try { db.exec('DELETE FROM fact_vec'); } catch { }
    db.exec('DELETE FROM job_queue');
    db.exec('DELETE FROM job_events');
    db.exec('DELETE FROM jobs');

    db.exec('PRAGMA foreign_keys = ON');
    db.close();

    console.log(`[TEST] Cleared test database content: ${testDbPath}`);
  } catch (error) {
    console.warn(`[TEST] Failed to clear test database content:`, error);
  }
}

// Verify test database is being used
export function verifyTestDb() {
  const testDbPath = path.join(process.cwd(), 'brain.test.db');
  const prodDbPath = path.join(process.cwd(), 'brain.db');

  const testDbExists = fs.existsSync(testDbPath);
  const prodDbExists = fs.existsSync(prodDbPath);

  console.log(`[TEST] Test DB exists: ${testDbExists} (${testDbPath})`);
  console.log(`[TEST] Prod DB exists: ${prodDbExists} (${prodDbPath})`);
  console.log(`[TEST] NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`[TEST] TEST_DB_PATH: ${process.env.TEST_DB_PATH}`);

  if (!testDbExists && prodDbExists) {
    console.warn(`[TEST] WARNING: Production database exists but test database does not. Make sure NODE_ENV=test is set.`);
  }
}

// Wait for API response
export async function waitForApiResponse(page: any, urlPattern: string | RegExp, timeout = 30000) {
  // Wait for both request and response
  const [response] = await Promise.all([
    page.waitForResponse(
      (response: any) => {
        const match = typeof urlPattern === 'string'
          ? response.url().includes(urlPattern)
          : urlPattern.test(response.url());
        return match && response.status() < 500;
      },
      { timeout }
    ),
    page.waitForTimeout(100), // Small delay to ensure request starts
  ]);
  return response;
}

// Wait for the chat stream completion (indicated by summarize button visibility)
export async function waitForChatCompletion(page: any, timeout = 60000) {
  const summarizeButton = page.locator('.summarize-button');
  await expect(summarizeButton).toBeVisible({ timeout });
  return summarizeButton;
}

// Reconcile the test user after DB cleanup
// This must match the user created in auth.setup.ts
export async function setupTestUser() {
  const email = 'test@example.com';
  // Use a known fixed ID for the test user to match session tokens if we were generating them statically,
  // but since we rely on the browser session cookie which contains the token signed with this user's ID,
  // we actually need to know *what ID* was used in auth.setup.ts.

  // However, since we cannot easily share state variables between processes without a file,
  // AND auth.setup.ts generates a random ID every run.

  // STRATEGY CHANGE: We will let auth.setup.ts write the User info to a file, 
  // and read it here to restore the SAME user.

  const authInfoPath = path.join(process.cwd(), 'playwright/.auth/user-info.json');
  if (fs.existsSync(authInfoPath)) {
    try {
      const userInfo = JSON.parse(fs.readFileSync(authInfoPath, 'utf-8'));

      // Check if user exists first
      const dbModule = await import('../src/lib/db');
      const existingUser = await dbModule.getUserById(userInfo.id);

      if (!existingUser) {
        // Re-create the user if missing
        const hashedPassword = await hashPassword('password123');
        await createUser(userInfo.id, userInfo.email, hashedPassword);

        console.log(`[TEST] Restored test user ${userInfo.email} (${userInfo.id})`);
      } else {
        // User already exists, no action needed
      }
    } catch (e) {
      console.error('[TEST] Failed to restore test user:', e);
    }
  } else {
    console.warn('[TEST] No user-info.json found. Tests might fail if they require a logged-in user.');
  }
}

// Create a unique user for test isolation and returns a valid auth token
export async function createUniqueUser() {
  const id = uuidv4();
  const email = `test-${id}@example.com`;

  // Create user in DB
  const hashedPassword = await hashPassword('password123');
  await createUser(id, email, hashedPassword);

  // Generate token
  const { generateToken } = await import('../src/lib/auth');
  const token = await generateToken(id);

  return { id, email, token };
}

// Seed fresh highlights for all three views to prevent auto-regeneration during tests
// Uses the job system to create succeeded jobs with output events
export function seedFreshHighlights(userId: string) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const now = new Date().toISOString();

  // Seed the prompt in KV store
  const upsertKV = db.prepare(`
    INSERT INTO user_kv_store (user_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  upsertKV.run(userId, 'highlights:prompt', 'Test prompt', now);

  // Delete existing jobs for this user
  const deleteJobs = db.prepare(`DELETE FROM jobs WHERE id LIKE ?`);
  deleteJobs.run(`highlights:${userId}:%`);

  // Create job and events for each view
  const insertJob = db.prepare(`
    INSERT INTO jobs (id, type, user_id, state, last_seq, last_input_seq, created_at, updated_at)
    VALUES (?, 'highlights', ?, 'succeeded', ?, 1, ?, ?)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO job_events (id, job_id, seq, kind, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const views = [
    { view: 'today', text: 'Test highlights data' },
    { view: 'tomorrow', text: 'Test tomorrow data' },
    { view: 'week', text: 'Test week data' },
  ];

  for (const { view, text } of views) {
    const jobId = `highlights:${userId}:${view}`;

    // Create the job in succeeded state
    insertJob.run(jobId, userId, 2, now, now);

    // Add input event
    insertEvent.run(
      uuidv4(),
      jobId,
      1,
      'input',
      JSON.stringify({ userId, view, userPrompt: 'Test prompt' }),
      now
    );

    // Add output event with the highlight text
    insertEvent.run(
      uuidv4(),
      jobId,
      2,
      'output',
      JSON.stringify({ text }),
      now
    );
  }

  db.close();
}

// Setup a browser page with a unique user's auth cookie
// This allows browser tests to run in parallel with isolated users
// By default, seeds fresh highlights to prevent auto-regeneration interference
export async function setupPageWithUser(page: any, options?: { skipHighlights?: boolean }) {
  const user = await createUniqueUser();

  // Inject auth cookie into the page's browser context
  await page.context().addCookies([{
    name: 'auth-token',
    value: user.token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  }]);

  // Seed fresh highlights by default to prevent auto-regeneration
  if (!options?.skipHighlights) {
    seedFreshHighlights(user.id);
  }

  return user;
}

/** Click the "New" dropdown and then click "Chat" */
export async function clickNewChat(page: any) {
  await page.locator('.new-btn').click();
  await page.locator('.new-chat-btn').click();
}

/** Click the "New" dropdown and then click "Doc" */
export async function clickNewDoc(page: any) {
  await page.locator('.new-btn').click();
  await page.locator('.new-doc-btn').click();
}

/** Click the "New" dropdown and then click "Files" */
export async function clickNewFileBrowser(page: any) {
  await page.locator('.new-btn').click();
  await page.locator('.new-menu-item').filter({ hasText: 'Files' }).click();
}

/** Click the "New" dropdown and then click "App" */
export async function clickNewApp(page: any) {
  await page.locator('.new-btn').click();
  await page.locator('.new-menu-item').filter({ hasText: 'App' }).click();
}
