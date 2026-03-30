import { Tool, ToolDefinition } from './types';
import { getToolContext, requireUserId } from './context';
import { getParentJobContext } from './job-context';
import { resolveApp, getAppSecretsAsEnv } from '../../db';
import {
  collectToolJobOutput,
  createAndStartToolJob,
  emitToolJobEvent,
  finalizeToolJob,
  pollToolJob,
} from './job-tool-utils';

const TOOL_YIELD_THRESHOLD_MS = parseInt(
  process.env.TOOL_YIELD_THRESHOLD_MS || '15000',
  10
);

const runAppDefinition: ToolDefinition = {
  name: 'run_app',
  shortDescription: 'Run an app by passing arguments to its CLI entry point (~/app/run).',
  description: `Run an app by passing arguments to its fixed entry point at ~/app/run.

The app must have an executable file at ~/app/run (the entry point).
This tool calls: ~/app/run <args>
You cannot run arbitrary shell commands — only pass arguments to the app's entry point.

- Use app_info to read the README and discover available arguments.
- The app has full read-write access to its own directory for maintaining state (DB, cache, etc).
- App secrets are injected as environment variables.
- No access to other apps' directories.

Use discover_apps to find apps, app_info to read the README.`,
  parameters: {
    type: 'OBJECT',
    properties: {
      app_name: {
        type: 'STRING',
        description: 'The app name to run.',
      },
      args: {
        type: 'STRING',
        description: 'Arguments to pass to the app entry point (~/app/run). Supports quoted strings for multi-word args. e.g. "\"latest war news\" --limit 10"',
      },
      timeout_seconds: {
        type: 'INTEGER',
        description: 'Maximum runtime in seconds (default 60, max 300)',
      },
    },
    required: ['app_name'],
  },
};

function boundedInt(value: any, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function executeRunApp(toolArgs: {
  app_name: string;
  args?: string;
  timeout_seconds?: number;
}): Promise<any> {
  const userId = requireUserId();
  const parentJob = getParentJobContext();
  const conversationId = parentJob?.jobInput?.conversationId;

  if (!conversationId || !parentJob) {
    return { error: 'Cannot execute command without active conversation job context.' };
  }

  if (!toolArgs.app_name) {
    return { error: 'app_name is required.' };
  }

  // Split args respecting quoted strings (single/double quotes)
  const cliArgs: string[] = [];
  const raw = (toolArgs.args || '').trim();
  if (raw) {
    const re = /"([^"]*)"| '([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      cliArgs.push(m[1] ?? m[2] ?? m[3]);
    }
  }
  const command = cliArgs.length ? `~/app/run ${cliArgs.join(' ')}` : '~/app/run';

  // Resolve app by name
  const app = await resolveApp(userId, toolArgs.app_name);
  if (!app) {
    return { error: `App not found: ${toolArgs.app_name}` };
  }

  // Get app secrets as env vars
  const appSecrets = await getAppSecretsAsEnv(app.id);

  const timeoutMs = boundedInt(toolArgs.timeout_seconds, 60, 1, 300) * 1000;
  const toolContext = getToolContext();
  const toolCallId = typeof toolContext?.toolCallId === 'string' ? toolContext.toolCallId : undefined;

  const job = await createAndStartToolJob('run-app', {
    cliArgs,
    timeoutMs,
    maxStdoutBytes: 131072,
    maxStderrBytes: 65536,
    appId: app.id,
    appSecrets,
    userId,
  }, userId);

  await emitToolJobEvent(job.id, runAppDefinition.name, conversationId, { command, callId: toolCallId, appId: app.id });

  const noYield = toolContext?.noYield === true;

  if (noYield) {
    const NO_YIELD_TIMEOUT_MS = 60_000;
    const polled = await pollToolJob(job.id, {
      timeout: NO_YIELD_TIMEOUT_MS,
      stopOnTimeout: true,
      signal: parentJob.signal,
    });

    const output = await collectToolJobOutput(job.id);
    const state = polled.success ? output.state : (polled.timedOut ? 'timeout' : output.state);
    await finalizeToolJob(job.id, state, output, output.error || polled.error);

    return {
      stdout: output.stdout,
      stderr: output.stderr,
      exit_code: output.exitCode,
      duration_ms: output.durationMs,
      ...(output.error || !polled.success ? { error: output.error || polled.error || 'Command failed.' } : {}),
    };
  }

  const thresholdMs = Math.min(timeoutMs + 5_000, TOOL_YIELD_THRESHOLD_MS);
  const polled = await pollToolJob(job.id, {
    timeout: thresholdMs,
    stopOnTimeout: false,
    signal: parentJob.signal,
  });

  if (!polled.success) {
    if (!polled.timedOut || parentJob.signal?.aborted) {
      const output = await collectToolJobOutput(job.id);
      await finalizeToolJob(job.id, output.state, output, output.error || polled.error);
      return {
        stdout: output.stdout,
        stderr: output.stderr,
        exit_code: output.exitCode,
        duration_ms: output.durationMs,
        async_job_id: job.id,
        error: polled.error || 'Command failed.',
      };
    }

    return {
      status: 'yielded',
      tool_call_id: toolCallId || 'unknown',
      job_id: job.id,
      async_job_id: job.id,
      message: 'This tool is still running in the background and will be resumed automatically when complete.',
    };
  }

  const output = await collectToolJobOutput(job.id);
  await finalizeToolJob(job.id, output.state, output, output.error || polled.error);

  return {
    stdout: output.stdout,
    stderr: output.stderr,
    exit_code: output.exitCode,
    duration_ms: output.durationMs,
    async_job_id: job.id,
    ...(output.error ? { error: output.error } : {}),
  };
}

export const runAppTools: Tool[] = [
  {
    definition: runAppDefinition,
    execute: executeRunApp,
    getResultEventExtra: (result: any) => {
      if (result?.async_job_id) return { async_job_id: result.async_job_id };
      return {};
    },
  },
];
