function parsePositiveIntEnv(name: string, fallback: number, min: number = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const value = Math.floor(parsed);
  if (value < min) return fallback;
  return value;
}

export function getYieldSessionTimeoutMs(): number {
  return parsePositiveIntEnv('YIELD_SESSION_TIMEOUT_MS', 300000);
}

export function getYieldSchedulerIntervalMs(): number {
  return parsePositiveIntEnv('YIELD_SCHEDULER_INTERVAL_MS', 1000);
}

export function getYieldSchedulerBatchSize(): number {
  return parsePositiveIntEnv('YIELD_SCHEDULER_BATCH_SIZE', 50);
}

export function getYieldResumeMaxAttempts(): number {
  return parsePositiveIntEnv('YIELD_RESUME_MAX_ATTEMPTS', 5);
}

export function getYieldResumeRetryBaseMs(): number {
  return parsePositiveIntEnv('YIELD_RESUME_RETRY_BASE_MS', 2000);
}

export function getYieldResumeQueueStaleMs(): number {
  return parsePositiveIntEnv('YIELD_RESUME_QUEUE_STALE_MS', 60000);
}

export function isKillToolCallJobEnabled(): boolean {
  const raw = String(process.env.ENABLE_KILL_TOOL_CALL_JOB || '').trim().toLowerCase();
  if (!raw) return true;
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}
