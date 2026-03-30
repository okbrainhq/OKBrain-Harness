/**
 * Worker Registry
 *
 * Starts all registered workers when the app initializes.
 * Import this module and call startWorkers() to start all workers.
 */

import { runWorker, getRegisteredWorkers, cleanupStaleJobs, createJob, startJob } from './index';
import { getConversationsWithLoopState, setConversationActiveJob, setConversationLoopState } from '../db';
import { v4 as uuidv4 } from 'uuid';

const WORKER_ID_PREFIX = `worker-${uuidv4().slice(0, 8)}`;

// Track if workers have been started
let workersStarted = false;

export async function startWorkers() {
  if (workersStarted) {
    return;
  }
  workersStarted = true;

  // Clean up any jobs that were running when app restarted
  try {
    const staleCount = await cleanupStaleJobs();
    if (staleCount > 0) {
      console.log(`[Workers] Cleaned up ${staleCount} stale job(s) from previous run`);
    }
  } catch (error) {
    console.error('[Workers] Error cleaning up stale jobs:', error);
  }

  // Auto-resume stalled infinite loops
  try {
    const stalled = await getConversationsWithLoopState('running');
    for (const conv of stalled) {
      if (!conv.loop_job_input) {
        // No saved input — can't resume, just clear the state
        await setConversationLoopState(conv.id, null, null);
        continue;
      }

      try {
        const savedInput = JSON.parse(conv.loop_job_input);
        const resumeInput = {
          userId: savedInput.userId,
          conversationId: savedInput.conversationId,
          userMessageId: '',  // No new user message — resuming mid-loop
          message: '',        // Empty — context comes from persisted events
          thinking: savedInput.thinking,
          mode: savedInput.mode,
          aiProvider: savedInput.aiProvider,
          documentIds: savedInput.documentIds || [],
          appId: savedInput.appId || null,
        };
        const job = await createJob('chat', undefined, savedInput.userId);
        await startJob(job.id, resumeInput);
        await setConversationActiveJob(savedInput.userId, savedInput.conversationId, job.id);
        console.log(`[AutoResume] Resumed loop for conversation ${conv.id}, new job ${job.id}`);
      } catch (error) {
        console.error(`[AutoResume] Failed to resume conversation ${conv.id}:`, error);
        await setConversationLoopState(conv.id, null, null);
      }
    }
  } catch (error) {
    console.error('[Workers] Error auto-resuming stalled loops:', error);
  }

  const workers = getRegisteredWorkers();
  console.log(`[Workers] Starting ${workers.length} registered workers...`);

  for (const worker of workers) {
    const workerId = `${WORKER_ID_PREFIX}-${worker.jobType}`;

    runWorker({
      workerId,
      jobType: worker.jobType,
      pollIntervalMs: worker.pollIntervalMs ?? 100,
      maxConcurrency: worker.maxConcurrency ?? 1,
      onJob: worker.onJob,
      onError: worker.onError ?? ((error, job) => {
        console.error(`[Worker ${workerId}] Error processing job ${job?.jobId}:`, error);
      })
    });

    console.log(`[Workers] Started worker for job type: ${worker.jobType}`);
  }
}
