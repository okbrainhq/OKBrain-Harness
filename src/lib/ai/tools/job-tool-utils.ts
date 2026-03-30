import { v4 as uuid } from 'uuid';
import {
  addConversationToolJob,
  updateConversationToolJobState,
} from '../../db';
import {
  getJobHistory,
  getJob,
  stopJob,
  createJob,
  startJob,
} from '../../jobs';
import { getParentJobContext } from './job-context';

export interface PollOptions {
  timeout?: number;
  pollInterval?: number;
  signal?: AbortSignal;
  stopOnTimeout?: boolean;
}

export interface ToolJobResult {
  success: boolean;
  output?: any;
  error?: string;
  timedOut?: boolean;
}

interface CollectedOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  state: 'succeeded' | 'failed' | 'stopped' | 'timeout';
  error?: string;
}

export async function createAndStartToolJob(
  type: string,
  input: any,
  userId: string
): Promise<{ id: string }> {
  const job = await createJob(type, undefined, userId);
  await startJob(job.id, input);
  return { id: job.id };
}

export async function emitToolJobEvent(
  toolJobId: string,
  toolName: string,
  conversationId: string,
  metadata?: Record<string, any>
): Promise<void> {
  const parentCtx = getParentJobContext();
  if (!parentCtx) return;

  await addConversationToolJob(
    uuid(),
    conversationId,
    parentCtx.jobId,
    toolJobId,
    toolName,
    metadata
  );

  await parentCtx.ctx.emit('output', {
    type: 'tool_job_started',
    toolJobId,
    toolName,
    state: 'running',
    seq: null,
    timestamp: new Date().toISOString(),
    ...(metadata?.command ? { command: metadata.command } : {}),
    ...(metadata?.callId ? { callId: metadata.callId } : {}),
  });
}

export async function pollToolJob(jobId: string, options: PollOptions = {}): Promise<ToolJobResult> {
  const timeout = options.timeout ?? 60_000;
  const pollInterval = options.pollInterval ?? 200;
  const stopOnTimeout = options.stopOnTimeout ?? true;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (options.signal?.aborted) {
      await stopJob(jobId);
      return { success: false, error: 'Tool job aborted by parent request.', timedOut: false };
    }

    const job = await getJob(jobId);
    if (!job) {
      return { success: false, error: 'Tool job not found.', timedOut: false };
    }

    if (job.state === 'succeeded') {
      return { success: true };
    }

    if (job.state === 'failed' || job.state === 'stopped') {
      return { success: false, error: `Tool job ended with state '${job.state}'.`, timedOut: false };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  if (stopOnTimeout) {
    await stopJob(jobId);
  }
  return {
    success: false,
    error: `Tool job timed out after ${Math.round(timeout / 1000)} seconds.`,
    timedOut: true,
  };
}

export async function collectToolJobOutput(jobId: string): Promise<CollectedOutput> {
  const events = await getJobHistory(jobId, 0);
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;
  let durationMs: number | null = null;
  let state: CollectedOutput['state'] = 'failed';
  let error: string | undefined;

  for (const event of events) {
    if (event.kind !== 'output') continue;
    let payload: any;
    try {
      payload = JSON.parse(event.payload);
    } catch {
      continue;
    }

    if (payload?.stream === 'stdout' && typeof payload.text === 'string') {
      stdout += payload.text;
    }

    if (payload?.stream === 'stderr' && typeof payload.text === 'string') {
      stderr += payload.text;
    }

    if (payload?.type === 'result') {
      if (typeof payload.exitCode === 'number') {
        exitCode = payload.exitCode;
      } else {
        exitCode = null;
      }
      durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;
      state = payload.state || (exitCode === 0 ? 'succeeded' : 'failed');
      if (typeof payload.error === 'string') {
        error = payload.error;
      }
    }
  }

  return { stdout, stderr, exitCode, durationMs, state, error };
}

export async function finalizeToolJob(
  jobId: string,
  state: 'succeeded' | 'failed' | 'stopped' | 'timeout',
  output: object,
  error?: string
): Promise<void> {
  await updateConversationToolJobState(jobId, state, output, error || null);
}
