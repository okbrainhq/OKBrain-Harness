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
 * The running test server's worker will pick it up.
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

test.describe('App Sandbox Isolation', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  let apiContext: any;
  let appA: any;
  let appB: any;
  const markerA = `MARKER_A_${Date.now()}`;
  const markerB = `MARKER_B_${Date.now()}`;

  test.beforeAll(async () => {
    const user = await createUniqueUser();
    apiContext = await createApiContext(user.token);

    // Create two apps
    appA = await (await apiContext.post('/api/apps', { data: { title: 'Sandbox A' } })).json();
    appB = await (await apiContext.post('/api/apps', { data: { title: 'Sandbox B' } })).json();

    // Write marker files into each app
    await apiContext.post('/api/filebrowser/fs/write', {
      data: { path: `apps/${appA.id}/marker.txt`, content: markerA },
    });
    await apiContext.post('/api/filebrowser/fs/write', {
      data: { path: `apps/${appB.id}/marker.txt`, content: markerB },
    });

    // Create a run script for App A that reads its own marker
    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${appA.id}/run`,
        content: '#!/bin/bash\ncat ~/app/marker.txt\n',
      },
    });

    // Create a run script for App B that tries to list ~/apps
    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${appB.id}/run`,
        content: '#!/bin/bash\nls ~/apps 2>&1\n',
      },
    });
  });

  test.afterAll(async () => {
    if (apiContext) await apiContext.dispose();
  });

  // ---- shell-command tests ----

  test('regular shell command cannot access ~/apps', async () => {
    const jobId = createJob('shell-command', {
      command: 'ls ~/apps 2>&1',
      timeoutMs: 15000,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).not.toBe(0);
  });

  test('app shell command can read own ~/app', async () => {
    const jobId = createJob('shell-command', {
      command: 'cat ~/app/marker.txt',
      timeoutMs: 15000,
      appId: appA.id,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(markerA);
  });

  test('app shell command cannot access ~/apps', async () => {
    const jobId = createJob('shell-command', {
      command: 'ls ~/apps 2>&1',
      timeoutMs: 15000,
      appId: appA.id,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).not.toBe(0);
  });

  test('app shell command cannot read other app files via ~/apps', async () => {
    const jobId = createJob('shell-command', {
      command: `cat ~/apps/${appB.id}/marker.txt 2>&1`,
      timeoutMs: 15000,
      appId: appA.id,
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain(markerB);
  });

  // ---- run-app tests ----

  test('run_app can read own ~/app files', async () => {
    const jobId = createJob('run-app', {
      cliArgs: [],
      timeoutMs: 15000,
      appId: appA.id,
      appSecrets: {},
    });
    const result = await waitForJobOutput(jobId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(markerA);
  });

  test('run_app cannot access ~/apps', async () => {
    const jobId = createJob('run-app', {
      cliArgs: [],
      timeoutMs: 15000,
      appId: appB.id,
      appSecrets: {},
    });
    const result = await waitForJobOutput(jobId);
    // App B's run script tries "ls ~/apps" — should fail
    expect(result.exitCode).not.toBe(0);
  });
});
