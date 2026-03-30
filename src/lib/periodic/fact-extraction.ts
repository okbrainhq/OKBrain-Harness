/**
 * Periodic Fact Extraction Trigger
 *
 * Creates and starts a fact-extraction job every 30 minutes.
 * The actual work is done by the fact-extraction worker.
 */

import { v4 as uuidv4 } from 'uuid';
import { createJob, startJob } from '../jobs';

const LOG_PREFIX = '[PeriodicFacts]';
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const STARTUP_DELAY_MS = 10 * 1000; // 10 seconds

async function triggerFactExtraction(): Promise<void> {
  try {
    const jobId = uuidv4();
    await createJob('fact-extraction', jobId);
    await startJob(jobId, {});
    console.log(`${LOG_PREFIX} Triggered fact-extraction job ${jobId}`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to trigger fact-extraction job:`, error);
  }
}

export function startPeriodicFactExtraction(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  console.log(`${LOG_PREFIX} Started (interval: ${intervalMs / 1000}s)`);

  // Run once after startup delay
  setTimeout(() => {
    triggerFactExtraction();
  }, STARTUP_DELAY_MS);

  // Then run periodically
  setInterval(() => {
    triggerFactExtraction();
  }, intervalMs);
}
