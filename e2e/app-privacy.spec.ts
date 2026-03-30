import { test, expect, request } from '@playwright/test';
import { loadTestEnv, verifyTestDb, createUniqueUser } from './test-utils';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

loadTestEnv();

let cleanupDone = false;
test.beforeAll(async () => {
  if (!cleanupDone) {
    if (process.env.VERIFY_DB !== 'false') {
      verifyTestDb();
      process.env.VERIFY_DB = 'false';
    }
    cleanupDone = true;
  }
});

function getDb() {
  const Database = require('better-sqlite3');
  return new Database(path.resolve(process.env.TEST_DB_PATH || 'brain.test.db'));
}

async function createApiContext(token: string) {
  return await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: { 'Cookie': `auth-token=${token}` },
  });
}

/**
 * Create a shell-command or run-app job directly in the DB.
 */
function createJob(type: 'shell-command' | 'run-app', input: Record<string, any>): string {
  const db = getDb();
  const jobId = uuidv4();
  const queueId = uuidv4();
  const now = new Date().toISOString();
  const inputStr = JSON.stringify(input);

  db.prepare(`
    INSERT INTO jobs (id, type, user_id, state, last_seq, last_input_seq, created_at, updated_at)
    VALUES (?, ?, NULL, 'idle', 0, 0, ?, ?)
  `).run(jobId, type, now, now);

  db.prepare(`
    INSERT INTO job_queue (id, job_id, input, priority, state, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'queued', ?, ?)
  `).run(queueId, jobId, inputStr, now, now);

  db.close();
  return jobId;
}

/**
 * Poll the DB until the job reaches succeeded/failed, then return the result event.
 */
async function waitForJobOutput(jobId: string, timeout = 30000): Promise<{
  state: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const db = getDb();
    const job = db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId) as any;

    if (job && (job.state === 'succeeded' || job.state === 'failed')) {
      const events = db.prepare(
        'SELECT payload FROM job_events WHERE job_id = ? AND kind = ? ORDER BY seq'
      ).all(jobId, 'output') as any[];
      db.close();

      for (const ev of events) {
        const payload = JSON.parse(ev.payload);
        if (payload.type === 'result') {
          return {
            state: job.state,
            stdout: payload.stdout || '',
            stderr: payload.stderr || '',
            exitCode: payload.exitCode ?? null,
          };
        }
      }
      return { state: job.state, stdout: '', stderr: '', exitCode: null };
    }

    db.close();
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
}

function ensureSharedFolder() {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM folders WHERE is_shared = 1 LIMIT 1').get() as any;
  if (existing) {
    db.close();
    return existing.id;
  }
  const folderId = 'global-shared-folder';
  db.prepare(`
    INSERT OR IGNORE INTO folders (id, name, user_id, is_shared)
    VALUES (?, 'Shared', 'system', 1)
  `).run(folderId);
  db.close();
  return folderId;
}

test.describe('App Privacy', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  let userA: { id: string; email: string; token: string };
  let userB: { id: string; email: string; token: string };
  let apiA: any;
  let apiB: any;
  let privateApp: any;
  let sharedFolderId: string;

  test.beforeAll(async () => {
    userA = await createUniqueUser();
    userB = await createUniqueUser();
    apiA = await createApiContext(userA.token);
    apiB = await createApiContext(userB.token);
    sharedFolderId = ensureSharedFolder();
  });

  test.afterAll(async () => {
    if (apiA) await apiA.dispose();
    if (apiB) await apiB.dispose();
  });

  test('user A can create an app', async () => {
    const resp = await apiA.post('/api/apps', {
      data: { title: 'Private App' },
    });
    expect(resp.status()).toBe(200);
    privateApp = await resp.json();
    expect(privateApp.id).toBeTruthy();
    expect(privateApp.user_id).toBe(userA.id);
  });

  test('user A can access own app', async () => {
    const resp = await apiA.get(`/api/apps/${privateApp.id}`);
    expect(resp.status()).toBe(200);
    const app = await resp.json();
    expect(app.id).toBe(privateApp.id);
  });

  test('user B cannot access user A private app', async () => {
    const resp = await apiB.get(`/api/apps/${privateApp.id}`);
    expect(resp.status()).toBe(404);
  });

  test('user A moves app to shared folder', async () => {
    const resp = await apiA.patch(`/api/apps/${privateApp.id}`, {
      data: { folder_id: sharedFolderId },
    });
    expect(resp.status()).toBe(200);
    const app = await resp.json();
    expect(app.folder_id).toBe(sharedFolderId);
  });

  test('user B can access shared app', async () => {
    const resp = await apiB.get(`/api/apps/${privateApp.id}`);
    expect(resp.status()).toBe(200);
    const app = await resp.json();
    expect(app.id).toBe(privateApp.id);
  });

  test('user A moves app back to private (no folder)', async () => {
    const resp = await apiA.patch(`/api/apps/${privateApp.id}`, {
      data: { folder_id: null },
    });
    expect(resp.status()).toBe(200);
  });

  test('user B cannot access app after moved back to private', async () => {
    const resp = await apiB.get(`/api/apps/${privateApp.id}`);
    expect(resp.status()).toBe(404);
  });
});

test.describe('OKBRAIN_USERID env variable', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  let user: { id: string; email: string; token: string };
  let apiContext: any;
  let app: any;

  test.beforeAll(async () => {
    user = await createUniqueUser();
    apiContext = await createApiContext(user.token);

    // Create an app for testing
    app = await (await apiContext.post('/api/apps', {
      data: { title: 'EnvTest App' },
    })).json();

    // Write a run script that prints OKBRAIN_USERID
    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${app.id}/run`,
        content: '#!/bin/bash\necho "USERID=$OKBRAIN_USERID"\n',
      },
    });
  });

  test.afterAll(async () => {
    if (apiContext) await apiContext.dispose();
  });

  test('shell-command receives OKBRAIN_USERID', async () => {
    const jobId = createJob('shell-command', {
      command: 'echo "USERID=$OKBRAIN_USERID"',
      timeoutMs: 15000,
      userId: user.id,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`USERID=${user.id}`);
  });

  test('shell-command in app context receives OKBRAIN_USERID', async () => {
    const jobId = createJob('shell-command', {
      command: 'echo "USERID=$OKBRAIN_USERID"',
      timeoutMs: 15000,
      appId: app.id,
      appSecrets: {},
      userId: user.id,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`USERID=${user.id}`);
  });

  test('run-app receives OKBRAIN_USERID', async () => {
    const jobId = createJob('run-app', {
      cliArgs: [],
      timeoutMs: 15000,
      appId: app.id,
      appSecrets: {},
      userId: user.id,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`USERID=${user.id}`);
  });
});
