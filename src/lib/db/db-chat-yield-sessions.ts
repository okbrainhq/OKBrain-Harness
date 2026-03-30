import { v4 as uuid } from 'uuid';
import {
  ChatYieldSession,
  ChatYieldSessionOriginExit,
  ChatYieldSessionResumeReason,
  ChatYieldSessionState,
  DbWrapper,
} from './db-types';

const DEFAULT_TIMEOUT_MS = 300000;

function computeDeadlineAt(nowMs: number, timeoutMs: number): string {
  return new Date(nowMs + timeoutMs).toISOString();
}

export async function createChatYieldSession(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  row: {
    conversationId: string;
    userId: string;
    originChatJobId: string;
    originExit: ChatYieldSessionOriginExit;
    yieldNote: string;
    deadlineAt?: string;
    nextCheckAt?: string;
    partialOutput?: string | null;
    partialThoughts?: string | null;
    partialThinkingDuration?: number | null;
  }
): Promise<ChatYieldSession> {
  await ensureInitialized();
  const existing = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE origin_chat_job_id = ?
  `).get(row.originChatJobId) as ChatYieldSession | undefined;

  if (existing) {
    return existing;
  }

  const nowMs = Date.now();

  // No deadline — yields wait indefinitely. Use year 9999 as sentinel.
  const deadlineAt = row.deadlineAt || '9999-12-31T23:59:59.999Z';
  const nextCheckAt = row.nextCheckAt || new Date(nowMs).toISOString();
  const id = uuid();
  await dbWrapper.prepare(`
    INSERT INTO chat_yield_sessions (
      id,
      conversation_id,
      user_id,
      origin_chat_job_id,
      origin_exit,
      state,
      yield_note,
      deadline_at,
      next_check_at,
      resume_reason,
      resume_attempt_count,
      last_error,
      resume_queued_at,
      timed_out_at,
      resume_job_id,
      partial_output,
      partial_thoughts,
      partial_thinking_duration,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    id,
    row.conversationId,
    row.userId,
    row.originChatJobId,
    row.originExit,
    row.yieldNote,
    deadlineAt,
    nextCheckAt,
    row.partialOutput ?? null,
    row.partialThoughts ?? null,
    row.partialThinkingDuration ?? null
  );

  const inserted = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE id = ?
  `).get(id);

  return inserted as ChatYieldSession;
}

export async function getChatYieldSessionById(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<ChatYieldSession | undefined> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE id = ?
  `).get(id);
  return row as ChatYieldSession | undefined;
}

export async function getChatYieldSessionByOriginChatJobId(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  originChatJobId: string
): Promise<ChatYieldSession | undefined> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE origin_chat_job_id = ?
  `).get(originChatJobId);
  return row as ChatYieldSession | undefined;
}

export async function getChatYieldSessionByResumeJobId(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  resumeJobId: string
): Promise<ChatYieldSession | undefined> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE resume_job_id = ?
  `).get(resumeJobId);
  return row as ChatYieldSession | undefined;
}

export async function updateChatYieldSessionState(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  state: ChatYieldSessionState,
  options?: {
    resumeJobId?: string | null;
    resumeReason?: ChatYieldSessionResumeReason | null;
    lastError?: string | null;
    timedOutAt?: string | null;
    deadlineAt?: string | null;
    nextCheckAt?: string | null;
    resumeQueuedAt?: string | null;
  }
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = ?,
        resume_job_id = COALESCE(?, resume_job_id),
        resume_reason = COALESCE(?, resume_reason),
        last_error = COALESCE(?, last_error),
        timed_out_at = COALESCE(?, timed_out_at),
        deadline_at = COALESCE(?, deadline_at),
        next_check_at = COALESCE(?, next_check_at),
        resume_queued_at = COALESCE(?, resume_queued_at),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    state,
    options?.resumeJobId ?? null,
    options?.resumeReason ?? null,
    options?.lastError ?? null,
    options?.timedOutAt ?? null,
    options?.deadlineAt ?? null,
    options?.nextCheckAt ?? null,
    options?.resumeQueuedAt ?? null,
    id
  );
}

export async function transitionChatYieldSessionState(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  fromState: ChatYieldSessionState,
  toState: ChatYieldSessionState
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND state = ?
  `).run(toState, id, fromState);
  return result.changes > 0;
}

export async function claimWaitingChatYieldSession(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  resumeQueuedAt: string
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = 'resume_queued',
        resume_queued_at = ?,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND state = 'waiting'
  `).run(resumeQueuedAt, id);

  return result.changes > 0;
}

export async function releaseChatYieldSessionClaim(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  options: {
    nextCheckAt: string;
    lastError?: string | null;
    incrementAttempt?: boolean;
    clearResumeJobId?: boolean;
  }
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = 'waiting',
        next_check_at = ?,
        resume_reason = NULL,
        resume_queued_at = NULL,
        last_error = ?,
        resume_attempt_count = CASE WHEN ? = 1 THEN resume_attempt_count + 1 ELSE resume_attempt_count END,
        resume_job_id = CASE WHEN ? = 1 THEN NULL ELSE resume_job_id END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND state = 'resume_queued'
  `).run(
    options.nextCheckAt,
    options.lastError ?? null,
    options.incrementAttempt ? 1 : 0,
    options.clearResumeJobId ? 1 : 0,
    id
  );
  return result.changes > 0;
}

export async function markChatYieldSessionResumed(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  data: {
    resumeJobId: string;
    resumeReason: ChatYieldSessionResumeReason;
    timedOutAt?: string | null;
  }
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = 'resumed',
        resume_job_id = ?,
        resume_reason = ?,
        timed_out_at = COALESCE(?, timed_out_at),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND state IN ('resume_queued', 'resumed')
  `).run(
    data.resumeJobId,
    data.resumeReason,
    data.timedOutAt ?? null,
    id
  );

  return result.changes > 0;
}

export async function markChatYieldSessionFailedFromResumeQueue(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  options: {
    lastError: string;
    incrementAttempt?: boolean;
  }
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = 'failed',
        last_error = ?,
        resume_attempt_count = CASE WHEN ? = 1 THEN resume_attempt_count + 1 ELSE resume_attempt_count END,
        resume_queued_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND state IN ('resume_queued', 'waiting')
  `).run(options.lastError, options.incrementAttempt ? 1 : 0, id);
  return result.changes > 0;
}

export async function backfillChatYieldSessionSchedulerFields(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  fields: {
    deadlineAt: string;
    nextCheckAt: string;
  }
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET deadline_at = COALESCE(deadline_at, ?),
        next_check_at = COALESCE(next_check_at, ?),
        resume_attempt_count = COALESCE(resume_attempt_count, 0),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(fields.deadlineAt, fields.nextCheckAt, id);
}

export async function listWaitingChatYieldSessionsForScheduler(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  nowIso: string,
  limit: number
): Promise<ChatYieldSession[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE state = 'waiting'
      AND (next_check_at IS NULL OR next_check_at <= ?)
    ORDER BY created_at ASC
    LIMIT ?
  `).all(nowIso, limit);
  return rows as ChatYieldSession[];
}

export async function listStaleResumeQueuedChatYieldSessionsForScheduler(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  staleBeforeIso: string,
  limit: number
): Promise<ChatYieldSession[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT ys.*
    FROM chat_yield_sessions ys
    LEFT JOIN jobs j ON ys.resume_job_id = j.id
    WHERE ys.state = 'resume_queued'
      AND ys.resume_queued_at IS NOT NULL
      AND ys.resume_queued_at <= ?
      AND (ys.resume_job_id IS NULL OR j.id IS NULL)
    ORDER BY ys.resume_queued_at ASC
    LIMIT ?
  `).all(staleBeforeIso, limit);
  return rows as ChatYieldSession[];
}

export async function cancelWaitingChatYieldSessionsForConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<number> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE chat_yield_sessions
    SET state = 'cancelled',
        updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
      AND state = 'waiting'
  `).run(conversationId);
  return result.changes;
}

export async function getLatestActiveChatYieldSessionForConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<ChatYieldSession | undefined> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE conversation_id = ?
      AND state IN ('waiting', 'resume_queued')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(conversationId);
  return row as ChatYieldSession | undefined;
}

export async function getAllActiveChatYieldSessionsForConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<ChatYieldSession[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT *
    FROM chat_yield_sessions
    WHERE conversation_id = ?
      AND state IN ('waiting', 'resume_queued')
    ORDER BY created_at ASC
  `).all(conversationId);
  return rows as ChatYieldSession[];
}
