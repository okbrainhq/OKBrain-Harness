import { spawn } from '../lib/spawn';
import { registerWorker, ClaimedJob, WorkerContext } from '../lib/jobs';
import { createDirectory } from '../lib/sandbox-fs';

interface ShellJobInput {
  command: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  appId?: string;
  appSecrets?: Record<string, string>;
  userId?: string;
}

type FinalState = 'succeeded' | 'failed' | 'stopped' | 'timeout';

const DEFAULT_STDOUT_LIMIT = 131072;
const DEFAULT_STDERR_LIMIT = 65536;

function clamp(n: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// Block env var keys that could compromise the sandbox
const BLOCKED_ENV_KEYS = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT', 'LD_DEBUG', 'GCONV_PATH', 'TZDIR']);

function validateEnvEntry(key: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    throw new Error(`Invalid env key: ${key}`);
  }
  if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) {
    throw new Error(`Cannot override protected env var: ${key}`);
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Env value for ${key} contains control characters`);
  }
}

function buildCommand(input: ShellJobInput): { program: string; args: string[] } {
  // InaccessiblePaths fails with exit code 226 if a path doesn't exist,
  // which kills the entire sandbox. Only include paths that are present.
  const isAppContext = !!input.appId;
  const appDir = isAppContext ? `/home/brain-sandbox/apps/${input.appId}` : null;

  // Always block the apps dir — the bind-mount to ~/app handles per-app access.
  const inaccessible = ['/var/www', '/root', '/home/brain-sandbox/apps'];

  // Always inject OKBRAIN_USERID if available
  const extraProps: string[] = [];
  if (input.userId) {
    validateEnvEntry('OKBRAIN_USERID', input.userId);
    extraProps.push(`--setenv=OKBRAIN_USERID=${input.userId}`);
  }

  // In app context: bind-mount the app dir to ~/app, inject secrets via systemd-run Environment
  if (isAppContext && appDir) {
    extraProps.push(`--property=BindPaths=${appDir}:/home/brain-sandbox/app`);
    extraProps.push('--property=ReadWritePaths=/home/brain-sandbox/app');

    // Inject app secrets as env vars inside the sandbox (not on the host spawn)
    if (input.appSecrets) {
      for (const [key, value] of Object.entries(input.appSecrets)) {
        validateEnvEntry(key, value);
        extraProps.push(`--setenv=${key}=${value}`);
      }
    }
  }

  return {
    program: 'sudo',
    args: [
      'systemd-run',
      '--wait',
      '--pipe',
      '--quiet',
      '--uid=brain-sandbox',
      '--gid=brain-sandbox',
      '--property=MemoryMax=256M',
      '--property=CPUQuota=50%',
      '--property=NoNewPrivileges=yes',
      '--property=ProtectSystem=strict',
      '--property=ProtectHome=tmpfs',
      '--property=BindPaths=/home/brain-sandbox',
      '--property=ReadWritePaths=/home/brain-sandbox',
      '--property=PrivateTmp=yes',
      ...(inaccessible.length > 0
        ? [`--property=InaccessiblePaths=${inaccessible.join(' ')}`]
        : []),
      ...extraProps,
      '--property=SystemCallFilter=~mount pivot_root open_by_handle_at bpf perf_event_open',
      '--property=SystemCallErrorNumber=EPERM',
      `--working-directory=${isAppContext ? '/home/brain-sandbox/app' : '/home/brain-sandbox'}`,
      '--',
      'bash',
      '-lc',
      input.command,
    ],
  };
}

async function handleShellCommandJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  const input = job.input as ShellJobInput;
  const timeoutMs = clamp(input.timeoutMs, 60000, 1000, 300000);
  const maxStdoutBytes = clamp(input.maxStdoutBytes, DEFAULT_STDOUT_LIMIT, 4096, 1048576);
  const maxStderrBytes = clamp(input.maxStderrBytes, DEFAULT_STDERR_LIMIT, 4096, 524288);
  const startedAt = Date.now();

  await ctx.emit('output', { type: 'init', command: input.command });

  // Ensure app directories exist before bind-mount (exit code 226 if source doesn't exist)
  if (input.appId) {
    try {
      await createDirectory(`apps/${input.appId}`);
      await createDirectory('app');
    } catch (e) {
      console.warn('[ShellWorker] Failed to create app dirs:', e);
    }
  }

  const { program, args } = buildCommand(input);
  const child = spawn(program, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let finalState: FinalState = 'succeeded';
  let timedOut = false;
  let stopped = false;
  let childExited = false;
  let exitCode: number | null = null;

  const appendLimited = (
    chunk: Buffer,
    current: string,
    currentBytes: number,
    limit: number,
    truncated: boolean
  ): { text: string; bytes: number; truncated: boolean; append: string } => {
    if (truncated) {
      return { text: current, bytes: currentBytes, truncated, append: '' };
    }
    const remaining = limit - currentBytes;
    if (remaining <= 0) {
      return { text: current, bytes: currentBytes, truncated: true, append: '' };
    }
    const slice = chunk.subarray(0, remaining);
    const append = slice.toString('utf8');
    const totalBytes = currentBytes + slice.length;
    const isTruncated = slice.length < chunk.length || totalBytes >= limit;
    return {
      text: current + append,
      bytes: totalBytes,
      truncated: isTruncated,
      append,
    };
  };

  const emitStream = async (stream: 'stdout' | 'stderr', text: string) => {
    if (!text) return;
    await ctx.emit('output', { stream, text });
  };

  child.stdout.on('data', async (chunk: Buffer) => {
    const next = appendLimited(chunk, stdout, stdoutBytes, maxStdoutBytes, stdoutTruncated);
    stdout = next.text;
    stdoutBytes = next.bytes;
    stdoutTruncated = next.truncated;
    await emitStream('stdout', next.append);
  });

  child.stderr.on('data', async (chunk: Buffer) => {
    const next = appendLimited(chunk, stderr, stderrBytes, maxStderrBytes, stderrTruncated);
    stderr = next.text;
    stderrBytes = next.bytes;
    stderrTruncated = next.truncated;
    await emitStream('stderr', next.append);
  });

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    finalState = 'timeout';
    child.kill('SIGTERM');
  }, timeoutMs);

  const stopWatcher = setInterval(async () => {
    if (childExited) return;
    if (await ctx.stopRequested()) {
      stopped = true;
      finalState = 'stopped';
      child.kill('SIGTERM');
    }
  }, 100);

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      childExited = true;
      exitCode = code;
      resolve();
    });
  });

  clearTimeout(timeoutTimer);
  clearInterval(stopWatcher);

  if (!timedOut && !stopped) {
    finalState = exitCode === 0 ? 'succeeded' : 'failed';
  }

  if (stdoutTruncated) {
    const marker = '\n[stdout truncated]\n';
    stdout += marker;
    await emitStream('stdout', marker);
  }
  if (stderrTruncated) {
    const marker = '\n[stderr truncated]\n';
    stderr += marker;
    await emitStream('stderr', marker);
  }

  const durationMs = Date.now() - startedAt;
  let error: string | undefined;
  if (timedOut) {
    error = `Command timed out after ${Math.round(timeoutMs / 1000)} seconds.`;
  } else if (stopped) {
    error = 'Command stopped by parent request.';
  } else if (finalState === 'failed') {
    error = `Command exited with code ${exitCode ?? 'unknown'}.`;
  }

  await ctx.emit('output', {
    type: 'result',
    state: finalState,
    exitCode,
    durationMs,
    stdout,
    stderr,
    truncated: { stdout: stdoutTruncated, stderr: stderrTruncated },
    ...(error ? { error } : {}),
  });

  await ctx.complete(finalState === 'succeeded');
}

registerWorker({
  jobType: 'shell-command',
  pollIntervalMs: 100,
  maxConcurrency: 3,
  onJob: handleShellCommandJob,
});
