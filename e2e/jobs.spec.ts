import { test, expect, request } from '@playwright/test';
import { loadTestEnv, verifyTestDb } from './test-utils';
import { v4 as uuidv4 } from 'uuid';

loadTestEnv();

test.beforeAll(async () => {
  if (process.env.VERIFY_DB !== 'false') {
    verifyTestDb();
    process.env.VERIFY_DB = 'false';
  }
});

test.describe('Job System API', () => {
  test.describe.configure({ mode: 'serial' });

  async function createRequestContext() {
    return await request.newContext({
      baseURL: 'http://localhost:3001',
    });
  }

  test('should create a new job', async () => {
    const ctx = await createRequestContext();

    const response = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });

    expect(response.ok()).toBeTruthy();
    const job = await response.json();
    expect(job).toHaveProperty('id');
    expect(job.type).toBe('test');
    expect(job.state).toBe('idle');
    expect(job.last_seq).toBe(0);
  });

  test('should create a job with custom id', async () => {
    const ctx = await createRequestContext();
    const customId = uuidv4();

    const response = await ctx.post('/api/jobs', {
      data: { type: 'test', id: customId }
    });

    expect(response.ok()).toBeTruthy();
    const job = await response.json();
    expect(job.id).toBe(customId);
  });

  test('should get job by id', async () => {
    const ctx = await createRequestContext();

    // Create job
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const created = await createResponse.json();

    // Get job
    const getResponse = await ctx.get(`/api/jobs/${created.id}`);
    expect(getResponse.ok()).toBeTruthy();

    const job = await getResponse.json();
    expect(job.id).toBe(created.id);
    expect(job.type).toBe('test');
  });

  test('should return 404 for non-existent job', async () => {
    const ctx = await createRequestContext();

    const response = await ctx.get('/api/jobs/non-existent-id');
    expect(response.status()).toBe(404);
  });

  test('should start a job with input', async () => {
    const ctx = await createRequestContext();

    // Create job
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const job = await createResponse.json();

    // Start job
    const startResponse = await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Hello, World!' } }
    });

    expect(startResponse.ok()).toBeTruthy();
    const result = await startResponse.json();
    expect(result).toHaveProperty('queueId');
    expect(result).toHaveProperty('inputSeq');
    expect(result.inputSeq).toBe(1);
  });

  test('should get job history after start', async () => {
    const ctx = await createRequestContext();

    // Create and start job
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const job = await createResponse.json();

    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Test message' } }
    });

    // Get history
    const historyResponse = await ctx.get(`/api/jobs/${job.id}/history`);
    expect(historyResponse.ok()).toBeTruthy();

    const history = await historyResponse.json();
    expect(history.events).toHaveLength(1);
    expect(history.events[0].kind).toBe('input');
    expect(history.events[0].payload).toEqual({ message: 'Test message' });
    expect(history.next_seq).toBe(1);
  });

  test('should get history with since_seq filter', async () => {
    const ctx = await createRequestContext();

    // Create job
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const job = await createResponse.json();

    // Start job twice to create multiple events
    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'First' } }
    });

    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Second' } }
    });

    // Get all history
    const allHistoryResponse = await ctx.get(`/api/jobs/${job.id}/history`);
    const allHistory = await allHistoryResponse.json();
    expect(allHistory.events).toHaveLength(2);

    // Get history since seq 1
    const filteredResponse = await ctx.get(`/api/jobs/${job.id}/history?since_seq=1`);
    const filtered = await filteredResponse.json();
    expect(filtered.events).toHaveLength(1);
    expect(filtered.events[0].payload.message).toBe('Second');
  });

  test('should stop a job', async () => {
    const ctx = await createRequestContext();

    // Create and start job
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const job = await createResponse.json();

    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Test' } }
    });

    // Stop job
    const stopResponse = await ctx.post(`/api/jobs/${job.id}/stop`);
    expect(stopResponse.ok()).toBeTruthy();

    const stoppedJob = await stopResponse.json();
    expect(stoppedJob.state).toBe('stopping');
  });

  test('should require type when creating job', async () => {
    const ctx = await createRequestContext();

    const response = await ctx.post('/api/jobs', {
      data: {}
    });

    expect(response.status()).toBe(400);
    const error = await response.json();
    expect(error.error).toBe('type is required');
  });

  test('should reject starting a running job', async () => {
    const ctx = await createRequestContext();

    // Create job with continuous mode
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test-continuous' }
    });
    const job = await createResponse.json();

    // Start job in continuous mode
    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { mode: 'continuous', intervalMs: 100 } }
    });

    // Wait for job to be running
    let jobState = 'idle';
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const currentJob = await jobResponse.json();
      jobState = currentJob.state;
      if (jobState === 'running') break;
    }
    expect(jobState).toBe('running');

    // Try to start again - should fail
    const startAgainResponse = await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Should fail' } }
    });

    expect(startAgainResponse.status()).toBe(409);
    const error = await startAgainResponse.json();
    expect(error.error).toBe('Job is already running');

    // Clean up - stop the job
    await ctx.post(`/api/jobs/${job.id}/stop`);
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  test('should stream job events via SSE', async () => {
    const ctx = await createRequestContext();

    // Create and start job
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const job = await createResponse.json();

    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Stream test' } }
    });

    // Connect to stream
    const streamResponse = await ctx.get(`/api/jobs/${job.id}/stream`);
    expect(streamResponse.ok()).toBeTruthy();
    expect(streamResponse.headers()['content-type']).toBe('text/event-stream');

    // Read the stream body - it should contain the input event
    const body = await streamResponse.text();
    expect(body).toContain('data:');
    expect(body).toContain('Stream test');
  });

  test('should stream with since_seq filter', async () => {
    const ctx = await createRequestContext();

    // Create job and add multiple events
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test' }
    });
    const job = await createResponse.json();

    // Start first job and wait for it to complete
    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'First', chunks: 2, delayMs: 100 } }
    });

    // Wait for first job to complete
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const currentJob = await jobResponse.json();
      if (currentJob.state === 'succeeded') break;
    }

    // Get the current sequence number after first job
    const historyResponse = await ctx.get(`/api/jobs/${job.id}/history`);
    const history = await historyResponse.json();
    const sinceSeq = history.next_seq;

    // Start second job
    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { message: 'Second', chunks: 2, delayMs: 100 } }
    });

    // Wait for second job to complete
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const currentJob = await jobResponse.json();
      if (currentJob.state === 'succeeded') break;
    }

    // Stream from after first job (should only get Second)
    const streamResponse = await ctx.get(`/api/jobs/${job.id}/stream?since_seq=${sinceSeq}`);
    expect(streamResponse.ok()).toBeTruthy();

    const body = await streamResponse.text();
    expect(body).not.toContain('First');
    expect(body).toContain('Second');
  });

  test('should stream continuous outputs and stop gracefully', async () => {
    const ctx = await createRequestContext();

    // Create job with dedicated type to avoid queue conflicts
    const createResponse = await ctx.post('/api/jobs', {
      data: { type: 'test-continuous' }
    });
    const job = await createResponse.json();

    // Start job in continuous mode with fast interval
    await ctx.post(`/api/jobs/${job.id}/start`, {
      data: { input: { mode: 'continuous', intervalMs: 100 } }
    });

    // Wait for job to be running (worker picked it up)
    let jobState = 'idle';
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const currentJob = await jobResponse.json();
      jobState = currentJob.state;
      if (jobState === 'running') break;
    }
    expect(jobState).toBe('running');

    // Wait for some outputs to be emitted
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check history - should have input + multiple output events
    const historyResponse = await ctx.get(`/api/jobs/${job.id}/history`);
    const history = await historyResponse.json();

    expect(history.events.length).toBeGreaterThan(1);
    expect(history.events[0].kind).toBe('input');

    // Find output events with tick pattern
    const outputEvents = history.events.filter((e: any) => e.kind === 'output' && e.payload.text?.startsWith('tick-'));
    expect(outputEvents.length).toBeGreaterThan(0);

    // Stop the job
    const stopResponse = await ctx.post(`/api/jobs/${job.id}/stop`);
    expect(stopResponse.ok()).toBeTruthy();

    // Wait for worker to process stop
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check final state
    const finalJobResponse = await ctx.get(`/api/jobs/${job.id}`);
    const finalJob = await finalJobResponse.json();
    expect(finalJob.state).toBe('succeeded');

    // Check history contains the stopped message
    const finalHistoryResponse = await ctx.get(`/api/jobs/${job.id}/history`);
    const finalHistory = await finalHistoryResponse.json();

    const stoppedEvent = finalHistory.events.find((e: any) => e.payload.final === true);
    expect(stoppedEvent).toBeDefined();
    expect(stoppedEvent.payload.text).toBe('[Stopped]');
  });

  test('should only allow one worker to claim each job when multiple workers compete (atomic claim)', async () => {
    const ctx = await createRequestContext();

    // Use 'test-race' type which has TWO workers registered, both competing for jobs
    // This tests the atomic claim mechanism under real race conditions
    const jobCount = 5;
    const createPromises = Array.from({ length: jobCount }, () =>
      ctx.post('/api/jobs', { data: { type: 'test-race' } })
    );
    const createResponses = await Promise.all(createPromises);
    const jobs = await Promise.all(createResponses.map(r => r.json()));

    // Start all jobs simultaneously - two workers will race to claim each job
    const startPromises = jobs.map(job =>
      ctx.post(`/api/jobs/${job.id}/start`, {
        data: { input: { message: 'Race test', delayMs: 50, chunks: 2 } }
      })
    );
    await Promise.all(startPromises);

    // Wait for all jobs to complete
    for (const job of jobs) {
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
        const currentJob = await jobResponse.json();
        if (currentJob.state === 'succeeded') break;
      }
    }

    // Verify each job was claimed and processed exactly once
    // (not claimed by both workers, which would cause duplicate processing)
    for (const job of jobs) {
      const historyResponse = await ctx.get(`/api/jobs/${job.id}/history`);
      const history = await historyResponse.json();

      // Each job should have exactly one input event
      const inputEvents = history.events.filter((e: any) => e.kind === 'input');
      expect(inputEvents.length).toBe(1);

      // Each job should have output events (meaning it was processed)
      const outputEvents = history.events.filter((e: any) => e.kind === 'output');
      expect(outputEvents.length).toBeGreaterThan(0);

      // Each job should have exactly one 'thought' event (final output from worker)
      // If both workers processed the job, there would be multiple thought events
      const thoughtEvents = history.events.filter((e: any) => e.kind === 'thought');
      expect(thoughtEvents.length).toBe(1);

      // Job should have completed successfully
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const finalJob = await jobResponse.json();
      expect(finalJob.state).toBe('succeeded');
    }
  });

  test('should return 404 when accessing job owned by another user', async () => {
    const ctx = await createRequestContext();
    const jobId = uuidv4();
    const fakeUserId = uuidv4();

    // Insert a job with a user_id directly into the database
    const Database = require('better-sqlite3');
    const path = require('path');
    const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
    const db = new Database(dbPath);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO jobs (id, type, user_id, state, last_seq, last_input_seq, created_at, updated_at)
      VALUES (?, ?, ?, 'idle', 0, 0, ?, ?)
    `).run(jobId, 'test', fakeUserId, now, now);
    db.close();

    // Try to access the job via API (no auth, so userId will be null)
    const response = await ctx.get(`/api/jobs/${jobId}`);
    expect(response.status()).toBe(404);
  });

  test('should process multiple jobs concurrently with maxConcurrency=3', async () => {
    const ctx = await createRequestContext();

    // Create 5 jobs for the concurrent worker (maxConcurrency=3)
    const jobCount = 5;
    const createPromises = Array.from({ length: jobCount }, () =>
      ctx.post('/api/jobs', { data: { type: 'test-concurrent' } })
    );
    const createResponses = await Promise.all(createPromises);
    const jobs = await Promise.all(createResponses.map(r => r.json()));

    // Start all jobs simultaneously with a noticeable delay to verify concurrency
    const startTime = Date.now();
    const startPromises = jobs.map(job =>
      ctx.post(`/api/jobs/${job.id}/start`, {
        data: { input: { message: 'Concurrent test', delayMs: 1000, chunks: 2 } }
      })
    );
    await Promise.all(startPromises);

    // Wait for all jobs to complete
    for (const job of jobs) {
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
        const currentJob = await jobResponse.json();
        if (currentJob.state === 'succeeded') break;
      }
    }

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    // Verify all jobs completed successfully
    for (const job of jobs) {
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const finalJob = await jobResponse.json();
      expect(finalJob.state).toBe('succeeded');

      const historyResponse = await ctx.get(`/api/jobs/${job.id}/history`);
      const history = await historyResponse.json();

      // Each job should have input, output chunks, and thought events
      const inputEvents = history.events.filter((e: any) => e.kind === 'input');
      expect(inputEvents.length).toBe(1);

      const outputEvents = history.events.filter((e: any) => e.kind === 'output');
      expect(outputEvents.length).toBe(2); // 2 chunks

      const thoughtEvents = history.events.filter((e: any) => e.kind === 'thought');
      expect(thoughtEvents.length).toBe(1);
    }

    // With maxConcurrency=3 and 5 jobs (each taking ~2 seconds):
    // - First 3 jobs run concurrently: ~2 seconds
    // - Next 2 jobs run concurrently: ~2 seconds
    // Total: ~4 seconds
    //
    // If sequential (maxConcurrency=1): 5 * 2 = 10 seconds
    //
    // We expect total time to be significantly less than sequential processing
    // Allow some overhead for job claiming and processing
    console.log(`[Test] Total time for 5 concurrent jobs: ${totalTime}ms`);
    expect(totalTime).toBeLessThan(7000); // Should be under 7 seconds (vs 10+ for sequential)
  });

  test('should handle concurrent job completions and claim new jobs', async () => {
    const ctx = await createRequestContext();

    // Create jobs with varying execution times
    const jobs = [];
    for (let i = 0; i < 6; i++) {
      const createResponse = await ctx.post('/api/jobs', {
        data: { type: 'test-concurrent' }
      });
      jobs.push(await createResponse.json());
    }

    // Start jobs with different delays (some finish faster than others)
    const delays = [300, 600, 300, 600, 300, 600]; // Alternating fast/slow
    const startPromises = jobs.map((job, i) =>
      ctx.post(`/api/jobs/${job.id}/start`, {
        data: { input: { message: 'Test', delayMs: delays[i], chunks: 2 } }
      })
    );
    await Promise.all(startPromises);

    // Wait for all to complete
    for (const job of jobs) {
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
        const currentJob = await jobResponse.json();
        if (currentJob.state === 'succeeded') break;
      }
    }

    // All jobs should complete successfully despite varying execution times
    for (const job of jobs) {
      const jobResponse = await ctx.get(`/api/jobs/${job.id}`);
      const finalJob = await jobResponse.json();
      expect(finalJob.state).toBe('succeeded');
    }
  });
});
