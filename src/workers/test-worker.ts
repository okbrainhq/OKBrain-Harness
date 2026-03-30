/**
 * Test Worker
 *
 * A simple worker that demonstrates the job system.
 * It processes jobs of type 'test' and 'test-continuous' and emits streaming output.
 *
 * This file registers itself when imported.
 */

import { registerWorker, ClaimedJob, WorkerContext } from '../lib/jobs';

async function handleTestJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  console.log(`[TestWorker] Processing job ${job.jobId}`);
  console.log(`[TestWorker] Input:`, job.input);

  const { mode = 'chunks', message = 'Hello, World!', chunks = 5, delayMs = 500, intervalMs = 1000 } = job.input;

  // Continuous mode: emit outputs every intervalMs until stopped
  if (mode === 'continuous') {
    console.log(`[TestWorker] Running in continuous mode`);
    ctx.status({ phase: 'running', mode: 'continuous' });

    let count = 0;
    while (true) {
      // Check if stop was requested
      if (await ctx.stopRequested()) {
        console.log(`[TestWorker] Stop requested, exiting gracefully`);
        await ctx.emit('output', { text: '[Stopped]', count, final: true });
        await ctx.complete(true);
        return;
      }

      count++;
      await ctx.emit('output', { text: `tick-${count}`, count, timestamp: Date.now() });

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  // Default chunks mode
  ctx.status({ phase: 'starting', progress: 0 });

  const words = message.split(' ');
  const chunkSize = Math.ceil(words.length / chunks);

  for (let i = 0; i < chunks; i++) {
    if (await ctx.stopRequested()) {
      console.log(`[TestWorker] Stop requested, exiting gracefully`);
      await ctx.emit('output', { text: '[Stopped]', final: true });
      await ctx.complete(true);
      return;
    }

    ctx.status({ phase: 'processing', progress: ((i + 1) / chunks) * 100 });

    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, words.length);
    const chunk = words.slice(start, end).join(' ');

    await ctx.emit('output', {
      text: chunk + (i < chunks - 1 ? ' ' : ''),
      chunkIndex: i,
      total: chunks
    });

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  await ctx.emit('thought', {
    text: `Processed message with ${words.length} words in ${chunks} chunks`
  });

  ctx.status({ phase: 'completed', progress: 100 });
  await ctx.complete(true);
  console.log(`[TestWorker] Job ${job.jobId} completed`);
}

// Register workers for both job types
registerWorker({
  jobType: 'test',
  pollIntervalMs: 100,
  maxConcurrency: 1,
  onJob: handleTestJob
});

registerWorker({
  jobType: 'test-continuous',
  pollIntervalMs: 100,
  maxConcurrency: 1,
  onJob: handleTestJob
});

// Register TWO workers for the same job type to test race condition
// Both workers will compete to claim jobs of type 'test-race'
registerWorker({
  jobType: 'test-race',
  pollIntervalMs: 50,
  maxConcurrency: 1,
  onJob: handleTestJob
});

registerWorker({
  jobType: 'test-race',
  pollIntervalMs: 50,
  maxConcurrency: 1,
  onJob: handleTestJob
});

// Register a worker with concurrent job processing (max 3 jobs at once)
registerWorker({
  jobType: 'test-concurrent',
  pollIntervalMs: 50,
  maxConcurrency: 3,
  onJob: handleTestJob
});
