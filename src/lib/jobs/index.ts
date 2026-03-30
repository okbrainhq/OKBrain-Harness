import { v4 as uuidv4 } from 'uuid';
import { Job, JobEvent, JobQueueItem, JobState } from '../db/db-types';
import * as jobOps from '../db/db-jobs';
import { appendToLog, truncateLogAfterSeq, deleteLog, readLogSince, watchLog } from './log';
import dbWrapper from '../db';
import { ensureInitialized } from '../db';

// Re-export log utilities for streaming
export { readLogSince, watchLog } from './log';

// Cleanup stale jobs from previous app restart
export async function cleanupStaleJobs(): Promise<number> {
  return jobOps.cleanupStaleJobs(dbWrapper, ensureInitialized);
}

// Job creation and management

export async function createJob(type: string, id?: string, userId?: string | null): Promise<Job> {
  const jobId = id || uuidv4();
  return jobOps.createJob(dbWrapper, ensureInitialized, jobId, type, userId ?? null);
}

export async function getJob(id: string): Promise<Job | null> {
  return jobOps.getJob(dbWrapper, ensureInitialized, id);
}

export async function updateJobState(id: string, state: JobState): Promise<void> {
  return jobOps.updateJobState(dbWrapper, ensureInitialized, id, state);
}

// Start a job by enqueueing an input
export async function startJob(jobId: string, input: any, priority: number = 0): Promise<{ queueId: string; inputSeq: number }> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Append input event to the log and DB
  const inputSeq = job.last_seq + 1;
  const inputEventId = uuidv4();
  const now = new Date().toISOString();
  const inputPayload = JSON.stringify(input);

  // Write to log first for streaming
  appendToLog(jobId, {
    seq: inputSeq,
    kind: 'input',
    payload: input,
    created_at: now
  });

  // Persist to DB
  await jobOps.addJobEvent(dbWrapper, ensureInitialized, inputEventId, jobId, inputSeq, 'input', inputPayload);
  await jobOps.updateJobSeq(dbWrapper, ensureInitialized, jobId, inputSeq, inputSeq);

  // Enqueue for worker
  const queueId = uuidv4();
  await jobOps.enqueueJob(dbWrapper, ensureInitialized, queueId, jobId, inputPayload, priority);

  return { queueId, inputSeq };
}

// Stop a job (set state to stopping)
export async function stopJob(jobId: string): Promise<void> {
  await updateJobState(jobId, 'stopping');
}

// Delete a job and all its events (CASCADE)
export async function deleteJob(jobId: string): Promise<void> {
  deleteLog(jobId);  // Clean up log file first
  await jobOps.deleteJob(dbWrapper, ensureInitialized, jobId);
}

// Get job history from DB
export async function getJobHistory(jobId: string, sinceSeq: number = 0): Promise<JobEvent[]> {
  return jobOps.getJobEvents(dbWrapper, ensureInitialized, jobId, sinceSeq);
}

// Resume a job after unexpected stop (truncate after last input and re-enqueue)
export async function resumeJob(jobId: string): Promise<{ queueId: string } | null> {
  const lastInput = await jobOps.getLastInputEvent(dbWrapper, ensureInitialized, jobId);
  if (!lastInput) {
    return null;
  }

  // Truncate events after the last input
  await jobOps.deleteJobEventsAfterSeq(dbWrapper, ensureInitialized, jobId, lastInput.seq);
  truncateLogAfterSeq(jobId, lastInput.seq);

  // Update job seq
  await jobOps.updateJobSeq(dbWrapper, ensureInitialized, jobId, lastInput.seq, lastInput.seq);

  // Re-enqueue with the same input
  const queueId = uuidv4();
  await jobOps.enqueueJob(dbWrapper, ensureInitialized, queueId, jobId, lastInput.payload, 0);
  await updateJobState(jobId, 'idle');

  return { queueId };
}

// Worker SDK

export interface ClaimedJob {
  jobId: string;
  queueId: string;
  input: any;
  currentSeq: number;
}

// Claim the next available job
export async function claimNext(workerId: string, jobType?: string): Promise<ClaimedJob | null> {
  // Keep trying until we find a valid job or no more jobs
  while (true) {
    const queueItem = await jobOps.claimNextJob(dbWrapper, ensureInitialized, workerId, jobType);
    if (!queueItem) {
      return null;
    }

    const job = await getJob(queueItem.job_id);
    if (!job) {
      // Job was deleted, mark queue item as failed and try next
      console.warn(`[Jobs] Job ${queueItem.job_id} no longer exists, skipping queue item`);
      try {
        await jobOps.completeQueueItem(dbWrapper, ensureInitialized, queueItem.id, queueItem.job_id, 'failed', 'failed');
      } catch {
        // Ignore errors when completing stale queue items
      }
      continue;
    }

    return {
      jobId: queueItem.job_id,
      queueId: queueItem.id,
      input: JSON.parse(queueItem.input),
      currentSeq: job.last_seq
    };
  }
}

// Emit an output event
export async function emit(
  jobId: string,
  kind: string,
  payload: any,
  currentSeq: number
): Promise<number> {
  const newSeq = currentSeq + 1;
  const eventId = uuidv4();
  const now = new Date().toISOString();
  const payloadStr = JSON.stringify(payload);

  // Write to log first for streaming
  appendToLog(jobId, {
    seq: newSeq,
    kind,
    payload,
    created_at: now
  });

  // Persist to DB (handle case where job was deleted)
  try {
    await jobOps.addJobEvent(dbWrapper, ensureInitialized, eventId, jobId, newSeq, kind, payloadStr);
    await jobOps.updateJobSeq(dbWrapper, ensureInitialized, jobId, newSeq);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      // Job was deleted, silently skip
    } else {
      throw error;
    }
  }

  return newSeq;
}

// Emit status (non-persistent, log only)
export function status(jobId: string, payload: any, currentSeq: number): number {
  const newSeq = currentSeq + 1;
  const now = new Date().toISOString();

  // Only write to log, not DB (status is ephemeral)
  appendToLog(jobId, {
    seq: newSeq,
    kind: 'status',
    payload,
    created_at: now
  });

  return newSeq;
}

// Complete a job
export async function complete(
  queueId: string,
  jobId: string,
  success: boolean = true
): Promise<void> {
  const queueState = success ? 'done' : 'failed';
  const jobState: JobState = success ? 'succeeded' : 'failed';

  try {
    await jobOps.completeQueueItem(dbWrapper, ensureInitialized, queueId, jobId, queueState, jobState);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      console.warn(`[Jobs] Job ${jobId} no longer exists, skipping completion`);
    } else {
      throw error;
    }
  }

  // Clean up log file after successful completion
  if (success) {
    deleteLog(jobId);
  }
}

// Check if stop was requested
export async function stopRequested(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  return job?.state === 'stopping';
}

// Worker loop helper
export interface WorkerOptions {
  workerId: string;
  jobType?: string;
  pollIntervalMs?: number;
  maxConcurrency?: number;
  onJob: (job: ClaimedJob, ctx: WorkerContext) => Promise<void>;
  onError?: (error: Error, job?: ClaimedJob) => void;
}

// Worker registration
export interface WorkerDefinition {
  jobType: string;
  pollIntervalMs?: number;
  maxConcurrency?: number;
  onJob: (job: ClaimedJob, ctx: WorkerContext) => Promise<void>;
  onError?: (error: Error, job?: ClaimedJob) => void;
}

const registeredWorkers: WorkerDefinition[] = [];

export function registerWorker(definition: WorkerDefinition): void {
  registeredWorkers.push(definition);
}

export function getRegisteredWorkers(): WorkerDefinition[] {
  return [...registeredWorkers];
}

export interface WorkerContext {
  emit: (kind: string, payload: any) => Promise<number>;
  status: (payload: any) => number;
  stopRequested: () => Promise<boolean>;
  complete: (success?: boolean) => Promise<void>;
}

export async function runWorker(options: WorkerOptions): Promise<never> {
  const {
    workerId,
    jobType,
    pollIntervalMs = 1000,
    maxConcurrency = 1,
    onJob,
    onError = console.error
  } = options;

  console.log(`[Worker ${workerId}] Starting worker for job type: ${jobType || 'any'} (max concurrency: ${maxConcurrency})`);

  // Track running jobs
  const runningJobs = new Set<Promise<void>>();

  async function processJob(claimed: ClaimedJob) {
    console.log(`[Worker ${workerId}] Claimed job ${claimed.jobId}`);
    let currentSeq = claimed.currentSeq;
    // Serialize emits to prevent seq collisions from concurrent calls
    let emitChain: Promise<void> = Promise.resolve();

    const ctx: WorkerContext = {
      emit: (kind: string, payload: any) => {
        const result = emitChain.then(async () => {
          currentSeq = await emit(claimed.jobId, kind, payload, currentSeq);
        });
        emitChain = result.catch(() => {});
        return result.then(() => currentSeq);
      },
      status: (payload: any) => {
        currentSeq = status(claimed.jobId, payload, currentSeq);
        return currentSeq;
      },
      stopRequested: () => stopRequested(claimed.jobId),
      complete: async (success: boolean = true) => {
        await complete(claimed.queueId, claimed.jobId, success);
      }
    };

    try {
      await onJob(claimed, ctx);
    } catch (error) {
      onError(error as Error, claimed);
      await complete(claimed.queueId, claimed.jobId, false);
    }
  }

  while (true) {
    try {
      // Clean up completed jobs
      const completedJobs = Array.from(runningJobs).filter(p => {
        // Check if promise is settled by racing with a resolved promise
        let isSettled = false;
        Promise.race([p, Promise.resolve()]).then(() => { isSettled = true; });
        return isSettled;
      });
      completedJobs.forEach(p => runningJobs.delete(p));

      // Claim new jobs if we have capacity
      while (runningJobs.size < maxConcurrency) {
        const claimed = await claimNext(workerId, jobType);

        if (claimed) {
          const jobPromise = processJob(claimed);
          runningJobs.add(jobPromise);

          // Remove from set when done
          jobPromise.finally(() => {
            runningJobs.delete(jobPromise);
          });
        } else {
          // No more jobs available
          break;
        }
      }

      // If no jobs are running and none available, wait before polling again
      if (runningJobs.size === 0) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } else {
        // Wait a bit before checking for more capacity
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      onError(error as Error);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }
}
