import { DbWrapper, Job, JobEvent, JobQueueItem, JobState, JobQueueState } from './db-types';

// Job operations

export async function createJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  type: string,
  userId: string | null = null
): Promise<Job> {
  await ensureInitialized();
  const now = new Date().toISOString();
  await dbWrapper.prepare(`
    INSERT INTO jobs (id, type, user_id, state, last_seq, last_input_seq, created_at, updated_at)
    VALUES (?, ?, ?, 'idle', 0, 0, ?, ?)
  `).run(id, type, userId, now, now);

  return {
    id,
    type,
    user_id: userId,
    state: 'idle',
    last_seq: 0,
    last_input_seq: 0,
    created_at: now,
    updated_at: now
  };
}

export async function getJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<Job | null> {
  await ensureInitialized();
  const job = await dbWrapper.prepare(`
    SELECT * FROM jobs WHERE id = ?
  `).get(id);
  return job || null;
}

export async function updateJobState(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  state: JobState
): Promise<void> {
  await ensureInitialized();
  const now = new Date().toISOString();
  await dbWrapper.prepare(`
    UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?
  `).run(state, now, id);
}

export async function updateJobSeq(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  lastSeq: number,
  lastInputSeq?: number
): Promise<void> {
  await ensureInitialized();
  const now = new Date().toISOString();
  if (lastInputSeq !== undefined) {
    await dbWrapper.prepare(`
      UPDATE jobs SET last_seq = ?, last_input_seq = ?, updated_at = ? WHERE id = ?
    `).run(lastSeq, lastInputSeq, now, id);
  } else {
    await dbWrapper.prepare(`
      UPDATE jobs SET last_seq = ?, updated_at = ? WHERE id = ?
    `).run(lastSeq, now, id);
  }
}

// Job Event operations

export async function addJobEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  jobId: string,
  seq: number,
  kind: string,
  payload: string
): Promise<JobEvent> {
  await ensureInitialized();
  const now = new Date().toISOString();
  await dbWrapper.prepare(`
    INSERT INTO job_events (id, job_id, seq, kind, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, jobId, seq, kind, payload, now);

  return {
    id,
    job_id: jobId,
    seq,
    kind,
    payload,
    created_at: now
  };
}

export async function getJobEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string,
  sinceSeq: number = 0
): Promise<JobEvent[]> {
  await ensureInitialized();
  const events = await dbWrapper.prepare(`
    SELECT * FROM job_events
    WHERE job_id = ? AND seq > ?
    ORDER BY seq ASC
  `).all(jobId, sinceSeq);
  return events;
}

export async function getJobEventsByKind(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string,
  kind: string,
  sinceSeq: number = 0
): Promise<JobEvent[]> {
  await ensureInitialized();
  const events = await dbWrapper.prepare(`
    SELECT * FROM job_events
    WHERE job_id = ? AND kind = ? AND seq > ?
    ORDER BY seq ASC
  `).all(jobId, kind, sinceSeq);
  return events;
}

export async function getLastInputEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string
): Promise<JobEvent | null> {
  await ensureInitialized();
  const event = await dbWrapper.prepare(`
    SELECT * FROM job_events
    WHERE job_id = ? AND kind = 'input'
    ORDER BY seq DESC
    LIMIT 1
  `).get(jobId);
  return event || null;
}

export async function deleteJobEventsAfterSeq(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string,
  seq: number
): Promise<number> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    DELETE FROM job_events WHERE job_id = ? AND seq > ?
  `).run(jobId, seq);
  return result.changes;
}

// Job Queue operations

export async function enqueueJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  jobId: string,
  input: string,
  priority: number = 0
): Promise<JobQueueItem> {
  await ensureInitialized();
  const now = new Date().toISOString();
  await dbWrapper.prepare(`
    INSERT INTO job_queue (id, job_id, input, priority, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `).run(id, jobId, input, priority, now, now);

  return {
    id,
    job_id: jobId,
    input,
    priority,
    state: 'queued',
    claimed_by: null,
    claimed_at: null,
    created_at: now,
    updated_at: now
  };
}

export async function claimNextJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  workerId: string,
  jobType?: string
): Promise<JobQueueItem | null> {
  await ensureInitialized();
  const now = new Date().toISOString();

  // Find the next queued item (optionally filtered by job type)
  let query = `
    SELECT jq.* FROM job_queue jq
    JOIN jobs j ON jq.job_id = j.id
    WHERE jq.state = 'queued'
  `;
  const params: any[] = [];

  if (jobType) {
    query += ` AND j.type = ?`;
    params.push(jobType);
  }

  query += ` ORDER BY jq.priority DESC, jq.created_at ASC LIMIT 1`;

  const item = await dbWrapper.prepare(query).get(...params);

  if (!item) {
    return null;
  }

  // Try to claim the item atomically - only succeeds if still queued
  const result = await dbWrapper.prepare(`
    UPDATE job_queue
    SET state = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
    WHERE id = ? AND state = 'queued'
  `).run(workerId, now, now, item.id);

  // If no rows changed, another worker claimed it first
  if (result.changes === 0) {
    return null;
  }

  // Update job state to running
  await dbWrapper.prepare(`
    UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?
  `).run(now, item.job_id);

  return {
    ...item,
    state: 'claimed' as JobQueueState,
    claimed_by: workerId,
    claimed_at: now,
    updated_at: now
  };
}

export async function completeQueueItem(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  queueId: string,
  jobId: string,
  state: 'done' | 'failed',
  jobState: JobState
): Promise<void> {
  await ensureInitialized();
  const now = new Date().toISOString();

  // Update queue item state
  await dbWrapper.prepare(`
    UPDATE job_queue SET state = ?, updated_at = ? WHERE id = ?
  `).run(state, now, queueId);

  // Update job state
  await dbWrapper.prepare(`
    UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?
  `).run(jobState, now, jobId);
}

export async function getQueueItem(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<JobQueueItem | null> {
  await ensureInitialized();
  const item = await dbWrapper.prepare(`
    SELECT * FROM job_queue WHERE id = ?
  `).get(id);
  return item || null;
}

export async function getJobQueueItems(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string
): Promise<JobQueueItem[]> {
  await ensureInitialized();
  const items = await dbWrapper.prepare(`
    SELECT * FROM job_queue WHERE job_id = ? ORDER BY created_at DESC
  `).all(jobId);
  return items;
}

export async function deleteJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<void> {
  await ensureInitialized();
  // CASCADE delete will clean up job_events and job_queue
  await dbWrapper.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

// Clean up stale jobs that were running when app restarted
export async function cleanupStaleJobs(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>
): Promise<number> {
  await ensureInitialized();
  const now = new Date().toISOString();

  // Find all jobs in 'running' state (they were interrupted)
  const staleJobs = await dbWrapper.prepare(`
    SELECT id FROM jobs WHERE state = 'running'
  `).all();

  if (staleJobs.length === 0) {
    return 0;
  }

  // Mark them as 'stopped'
  await dbWrapper.prepare(`
    UPDATE jobs SET state = 'stopped', updated_at = ? WHERE state = 'running'
  `).run(now);

  // Also mark any 'claimed' queue items as 'failed'
  await dbWrapper.prepare(`
    UPDATE job_queue SET state = 'failed', updated_at = ? WHERE state = 'claimed'
  `).run(now);

  // Clear active_job_id on conversations pointing to jobs that are no longer running.
  // This prevents conversations from being permanently stuck after a crash.
  const orphaned = await dbWrapper.prepare(`
    UPDATE conversations
    SET active_job_id = NULL
    WHERE active_job_id IS NOT NULL
      AND active_job_id NOT IN (SELECT id FROM jobs WHERE state IN ('running', 'idle'))
  `).run();
  if (orphaned.changes > 0) {
    console.log(`[Jobs] Cleared orphaned active_job_id on ${orphaned.changes} conversation(s)`);
  }

  return staleJobs.length;
}

