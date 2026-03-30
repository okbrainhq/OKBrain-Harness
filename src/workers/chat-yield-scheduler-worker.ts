import {
  backfillChatYieldSessionSchedulerFields,
  claimWaitingChatYieldSession,
  getAsyncToolCallLogsByParentJob,
  getChatYieldSessionById,
  getConversation,
  getConversationToolJobsByParentJob,
  getYieldedToolCallLogsByParentJob,
  listStaleResumeQueuedChatYieldSessionsForScheduler,
  listWaitingChatYieldSessionsForScheduler,
  markChatYieldSessionFailedFromResumeQueue,
  markChatYieldSessionResumed,
  releaseChatYieldSessionClaim,
  setConversationActiveJob,
  trySetConversationActiveJob,
  updateConversationToolJobState,
  updateToolCallLogResult,
} from '../lib/db';
import type { ChatYieldSession, ToolCallLog } from '../lib/db';
import { collectToolJobOutput } from '../lib/ai/tools/job-tool-utils';
import { createJob, getJob, startJob } from '../lib/jobs';
import type { ChatJobInput } from './chat-worker';
import {
  getYieldResumeMaxAttempts,
  getYieldResumeQueueStaleMs,
  getYieldResumeRetryBaseMs,
  getYieldSchedulerBatchSize,
  getYieldSchedulerIntervalMs,
  getYieldSessionTimeoutMs,
} from '../lib/yield-orchestration';

const LOG_PREFIX = '[ChatYieldScheduler]';
const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'stopped', 'timeout']);

let schedulerStarted = false;
let schedulerInFlight = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

interface ResumeToolCallSnapshot {
  tool_call_id: string;
  tool_name: string;
  log_status: 'yielded' | 'succeeded' | 'failed';
  job_state: string | null;
  is_terminal: boolean;
  response: any;
  error: string | null;
}

function parseJson(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toFinalToolCallStatus(state: string): 'succeeded' | 'failed' {
  return state === 'succeeded' ? 'succeeded' : 'failed';
}

function nowIso(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function buildResumeJobId(sessionId: string): string {
  return `chat-resume-${sessionId}`;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function computeRetryDelayMs(attemptCount: number): number {
  const base = getYieldResumeRetryBaseMs();
  const exp = Math.max(0, attemptCount - 1);
  return base * (2 ** exp);
}

function isJobStateTerminal(state: string | null | undefined): boolean {
  if (!state) return false;
  return TERMINAL_JOB_STATES.has(state);
}

async function finalizeYieldedToolCall(log: ToolCallLog): Promise<'pending' | 'done'> {
  if (!log.async_job_id) {
    await updateToolCallLogResult(log.id, {
      status: 'failed',
      error: 'Yielded tool call is missing async_job_id.',
    });
    return 'done';
  }

  const childJob = await getJob(log.async_job_id);
  if (!childJob) {
    const message = `Async tool job '${log.async_job_id}' not found.`;
    await updateToolCallLogResult(log.id, {
      status: 'failed',
      error: message,
    });
    await updateConversationToolJobState(log.async_job_id, 'failed', {}, message);
    return 'done';
  }

  if (!['succeeded', 'failed', 'stopped'].includes(childJob.state)) {
    return 'pending';
  }

  const output = await collectToolJobOutput(log.async_job_id);
  const finalStatus = toFinalToolCallStatus(output.state);
  const finalError = output.error || (finalStatus === 'failed'
    ? `Tool job '${log.async_job_id}' ended with state '${output.state}'.`
    : null);

  await updateToolCallLogResult(log.id, {
    status: finalStatus,
    response: {
      stdout: output.stdout,
      stderr: output.stderr,
      exit_code: output.exitCode,
      duration_ms: output.durationMs,
      ...(output.error ? { error: output.error } : {}),
    },
    error: finalError,
  });

  await updateConversationToolJobState(log.async_job_id, output.state, output, finalError);
  return 'done';
}

async function reconcileToolCallLogs(parentJobId: string): Promise<{
  allCompleted: boolean;
  toolCalls: ResumeToolCallSnapshot[];
}> {
  const yieldedLogs = await getYieldedToolCallLogsByParentJob(parentJobId);

  for (const log of yieldedLogs) {
    await finalizeYieldedToolCall(log);
  }

  const asyncLogs = await getAsyncToolCallLogsByParentJob(parentJobId);
  const conversationToolJobs = await getConversationToolJobsByParentJob(parentJobId);
  const toolJobStateByJobId = new Map<string, string>();
  for (const toolJob of conversationToolJobs) {
    toolJobStateByJobId.set(toolJob.job_id, toolJob.state);
  }

  const runtimeStateByJobId = new Map<string, string | null>();
  for (const log of asyncLogs) {
    if (!log.async_job_id || runtimeStateByJobId.has(log.async_job_id)) continue;
    const child = await getJob(log.async_job_id);
    runtimeStateByJobId.set(log.async_job_id, child?.state || null);
  }

  const toolCalls: ResumeToolCallSnapshot[] = asyncLogs.map((log) => {
    const logStatus = log.status === 'yielded'
      ? 'yielded'
      : (log.status === 'succeeded' ? 'succeeded' : 'failed');

    const jobState = log.async_job_id
      ? (toolJobStateByJobId.get(log.async_job_id) || runtimeStateByJobId.get(log.async_job_id) || null)
      : null;
    const terminalByLog = logStatus === 'succeeded' || logStatus === 'failed';
    const isTerminal = terminalByLog || isJobStateTerminal(jobState);

    return {
      tool_call_id: log.tool_call_id,
      tool_name: log.tool_name,
      log_status: logStatus,
      job_state: jobState,
      is_terminal: isTerminal,
      response: parseJson(log.response),
      error: log.error ?? null,
    };
  });

  const allCompleted = !toolCalls.some((call) => call.log_status === 'yielded' && !call.is_terminal);
  return { allCompleted, toolCalls };
}

async function ensureSessionSchedulerFields(session: ChatYieldSession, nowMs: number): Promise<ChatYieldSession> {
  const timeoutMs = getYieldSessionTimeoutMs();
  const deadlineAt = session.deadline_at || new Date(nowMs + timeoutMs).toISOString();
  const nextCheckAt = session.next_check_at || new Date(nowMs).toISOString();

  if (!session.deadline_at || !session.next_check_at || (session as any).resume_attempt_count == null) {
    await backfillChatYieldSessionSchedulerFields(session.id, {
      deadlineAt,
      nextCheckAt,
    });
  }

  const refreshed = await getChatYieldSessionById(session.id);
  return refreshed || {
    ...session,
    deadline_at: deadlineAt,
    next_check_at: nextCheckAt,
    resume_attempt_count: Number((session as any).resume_attempt_count || 0),
  };
}

async function failOrRetryResumeQueueSession(
  session: ChatYieldSession,
  errorMessage: string,
  nowMs: number
): Promise<void> {
  const currentAttempts = Number((session as any).resume_attempt_count || 0);
  const nextAttempt = currentAttempts + 1;
  const maxAttempts = getYieldResumeMaxAttempts();

  if (nextAttempt >= maxAttempts) {
    await markChatYieldSessionFailedFromResumeQueue(session.id, {
      lastError: errorMessage,
      incrementAttempt: true,
    });
    console.error(`${LOG_PREFIX} Session ${session.id} failed after ${nextAttempt} attempts: ${errorMessage}`);
    return;
  }

  const delayMs = computeRetryDelayMs(nextAttempt);
  await releaseChatYieldSessionClaim(session.id, {
    nextCheckAt: nowIso(nowMs + delayMs),
    lastError: errorMessage,
    incrementAttempt: true,
    clearResumeJobId: true,
  });
  console.warn(
    `${LOG_PREFIX} Session ${session.id} retry ${nextAttempt}/${maxAttempts} in ${delayMs}ms: ${errorMessage}`
  );
}

interface PreparedResumeJob {
  resumeJobId: string;
  resumeInput: ChatJobInput;
  needsStart: boolean;
}

async function prepareResumeJob(
  session: ChatYieldSession,
  resumeReason: 'all_completed' | 'timeout_decision',
  toolCalls: ResumeToolCallSnapshot[],
  nowMs: number
): Promise<PreparedResumeJob> {
  const conversation = await getConversation(session.user_id, session.conversation_id);
  if (!conversation) {
    throw new Error(`Conversation '${session.conversation_id}' not found.`);
  }

  const timeoutMs = getYieldSessionTimeoutMs();
  const createdAtMs = parseMs(session.created_at);
  const elapsedMs = createdAtMs !== null ? Math.max(0, nowMs - createdAtMs) : timeoutMs;
  const resumeJobId = buildResumeJobId(session.id);
  const resumeInput: ChatJobInput = {
    userId: session.user_id,
    conversationId: session.conversation_id,
    userMessageId: '',
    message: '',
    thinking: false,
    mode: (conversation.response_mode === 'quick' ? 'quick' : 'detailed'),
    aiProvider: (conversation.ai_provider as any) || 'gemini',
    location: undefined,
    documentIds: conversation.document_ids || [],
    contentContexts: [],
    resumeContext: {
      yieldSessionId: session.id,
      yieldNote: session.yield_note,
      originChatJobId: session.origin_chat_job_id,
      resumeReason,
      timeoutMs,
      elapsedMs,
      partialOutput: session.partial_output || undefined,
      partialThoughts: session.partial_thoughts || undefined,
      partialThinkingDuration: session.partial_thinking_duration ?? undefined,
      toolCalls,
    },
  };

  const existing = await getJob(resumeJobId);
  if (!existing) {
    await createJob('chat', resumeJobId, session.user_id);
    return { resumeJobId, resumeInput, needsStart: true };
  }

  if (existing.type !== 'chat') {
    throw new Error(`Job id collision for resume job '${resumeJobId}' (existing type=${existing.type}).`);
  }

  return { resumeJobId, resumeInput, needsStart: existing.state === 'idle' };
}

async function processWaitingSession(session: ChatYieldSession, nowMs: number): Promise<void> {
  const claimed = await claimWaitingChatYieldSession(session.id, nowIso(nowMs));
  if (!claimed) {
    return;
  }

  const claimedSession = await getChatYieldSessionById(session.id);
  if (!claimedSession) {
    return;
  }

  const hydrated = await ensureSessionSchedulerFields(claimedSession, nowMs);

  try {
    const reconciled = await reconcileToolCallLogs(hydrated.origin_chat_job_id);

    if (!reconciled.allCompleted) {
      // Tools still running — check back later
      await releaseChatYieldSessionClaim(hydrated.id, {
        nextCheckAt: nowIso(nowMs + getYieldSchedulerIntervalMs()),
      });
      return;
    }

    // All tools complete — check if conversation is busy before resuming
    const conv = await getConversation(hydrated.user_id, hydrated.conversation_id);
    if (conv?.active_job_id) {
      // Conversation is busy — retry later
      await releaseChatYieldSessionClaim(hydrated.id, {
        nextCheckAt: nowIso(nowMs + 3000),
        lastError: 'conversation_busy',
      });
      return;
    }

    const prepared = await prepareResumeJob(
      hydrated,
      'all_completed',
      reconciled.toolCalls,
      nowMs
    );

    // Atomically claim the conversation to prevent races.
    // The job is created but NOT started yet — only start after claiming.
    const claimed = await trySetConversationActiveJob(
      hydrated.user_id, hydrated.conversation_id, prepared.resumeJobId
    );
    if (!claimed) {
      // Race condition — another job claimed it first.
      // Job stays idle and will be reused on the next attempt.
      await releaseChatYieldSessionClaim(hydrated.id, {
        nextCheckAt: nowIso(nowMs + 3000),
        lastError: 'conversation_busy_race',
      });
      return;
    }

    // Conversation claimed — now safe to start the resume job
    if (prepared.needsStart) {
      await startJob(prepared.resumeJobId, prepared.resumeInput);
    }

    await markChatYieldSessionResumed(hydrated.id, {
      resumeJobId: prepared.resumeJobId,
      resumeReason: 'all_completed',
      timedOutAt: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failOrRetryResumeQueueSession(hydrated, message, nowMs);
  }
}

async function recoverStaleResumeQueuedSession(session: ChatYieldSession, nowMs: number): Promise<void> {
  const expectedResumeJobId = buildResumeJobId(session.id);
  const existingResumeJob = await getJob(expectedResumeJobId);

  if (existingResumeJob && existingResumeJob.type === 'chat') {
    const resumeReason = session.resume_reason || 'all_completed';
    await markChatYieldSessionResumed(session.id, {
      resumeJobId: expectedResumeJobId,
      resumeReason,
      timedOutAt: session.timed_out_at ?? null,
    });

    if (['idle', 'running', 'stopping'].includes(existingResumeJob.state)) {
      await setConversationActiveJob(session.user_id, session.conversation_id, expectedResumeJobId);
    }
    return;
  }

  await failOrRetryResumeQueueSession(
    session,
    'Recovered stale resume_queued session without a valid resume job.',
    nowMs
  );
}

export async function runChatYieldSchedulerTick(): Promise<void> {
  const nowMs = Date.now();
  const batchSize = getYieldSchedulerBatchSize();
  const staleCutoffIso = nowIso(nowMs - getYieldResumeQueueStaleMs());
  const staleSessions = await listStaleResumeQueuedChatYieldSessionsForScheduler(staleCutoffIso, batchSize);
  for (const stale of staleSessions) {
    await recoverStaleResumeQueuedSession(stale, nowMs);
  }

  const waitingSessions = await listWaitingChatYieldSessionsForScheduler(nowIso(nowMs), batchSize);
  for (const session of waitingSessions) {
    await processWaitingSession(session, nowMs);
  }
}

function startChatYieldScheduler(): void {
  if (schedulerStarted) {
    return;
  }
  schedulerStarted = true;

  const intervalMs = getYieldSchedulerIntervalMs();
  console.log(`${LOG_PREFIX} Started (interval=${intervalMs}ms, batch=${getYieldSchedulerBatchSize()})`);

  const tick = async () => {
    if (schedulerInFlight) return;
    schedulerInFlight = true;
    try {
      await runChatYieldSchedulerTick();
    } catch (error) {
      console.error(`${LOG_PREFIX} Tick failed:`, error);
    } finally {
      schedulerInFlight = false;
    }
  };

  // Kick once on startup for fast recovery.
  setTimeout(() => {
    void tick();
  }, 200);

  schedulerTimer = setInterval(() => {
    void tick();
  }, intervalMs);

  if (schedulerTimer && typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }
}

startChatYieldScheduler();
