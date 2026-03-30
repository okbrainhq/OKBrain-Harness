/**
 * Periodic Fact Sheet Rebuild Trigger
 *
 * Creates and starts a fact-sheet-daily-rebuild job every 24 hours.
 * The actual work is done by the fact-sheet-rebuild worker.
 *
 * On startup, checks when the last Gemini rebuild ran and skips/delays
 * accordingly so server restarts don't re-trigger the rebuild too early.
 */

import { v4 as uuidv4 } from 'uuid';
import { createJob, startJob } from '../jobs';
import { getLastFactSheetTimeBySource } from '../db';

const LOG_PREFIX = '[PeriodicFactSheetRebuild]';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STARTUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

async function triggerFactSheetRebuild(): Promise<void> {
  try {
    const jobId = uuidv4();
    await createJob('fact-sheet-daily-rebuild', jobId);
    await startJob(jobId, {});
    console.log(`${LOG_PREFIX} Triggered fact-sheet-daily-rebuild job ${jobId}`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to trigger fact-sheet-daily-rebuild job:`, error);
  }
}

export function startPeriodicFactSheetRebuild(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  console.log(`${LOG_PREFIX} Started (interval: ${intervalMs / 1000}s)`);

  // After startup delay, check if we need to run now or wait
  setTimeout(async () => {
    try {
      const lastRebuildTime = await getLastFactSheetTimeBySource('gemini');

      if (lastRebuildTime) {
        const elapsed = Date.now() - new Date(lastRebuildTime + 'Z').getTime();
        const remaining = intervalMs - elapsed;

        if (remaining > 0) {
          console.log(`${LOG_PREFIX} Last rebuild was ${Math.round(elapsed / 1000 / 60)}min ago, next in ${Math.round(remaining / 1000 / 60)}min`);
          setTimeout(() => {
            triggerFactSheetRebuild();
            setInterval(triggerFactSheetRebuild, intervalMs);
          }, remaining);
          return;
        }
      }

      // No previous rebuild or it's overdue — run now
      console.log(`${LOG_PREFIX} Running rebuild now${lastRebuildTime ? ' (overdue)' : ' (no previous rebuild)'}`);
      triggerFactSheetRebuild();
    } catch (error) {
      console.error(`${LOG_PREFIX} Error checking last rebuild time, running now:`, error);
      triggerFactSheetRebuild();
    }

    // Then run periodically
    setInterval(triggerFactSheetRebuild, intervalMs);
  }, STARTUP_DELAY_MS);
}
