import { Tool, ToolDefinition } from './types';
import { getToolContext, requireUserId } from './context';
import { getParentJobContext } from './job-context';
import {
  collectToolJobOutput,
  createAndStartToolJob,
  emitToolJobEvent,
  finalizeToolJob,
  pollToolJob,
} from './job-tool-utils';

// Allow override via environment for testing (e.g., TOOL_YIELD_THRESHOLD_MS=5000)
const TOOL_YIELD_THRESHOLD_MS = parseInt(
  process.env.TOOL_YIELD_THRESHOLD_MS || '15000',
  10
);

const shellCommandDefinition: ToolDefinition = {
  name: 'run_shell_command',
  shortDescription: 'Execute a shell command. Available: bash, curl, wget, git, jq, python3 (with matplotlib, numpy, pandas), node. Working dir: /home/brain-sandbox. Save images to /home/brain-sandbox/upload_images/ then use shell_image_upload.',
  description: `Execute shell commands in a sandboxed server environment.

Environment:
- Working directory: /home/brain-sandbox
- PATH includes: /home/brain-sandbox/.local/bin

Available tools:
- bash, curl, wget, git, jq
- ffmpeg, imagemagick (convert/identify)
- python3 (with numpy, pandas, scikit-learn, matplotlib, pypdf, pdfplumber, yfinance)
- node, npm

Use this tool for data processing, file manipulation, web requests, media conversion, scripting, and analysis.`,
  parameters: {
    type: 'OBJECT',
    properties: {
      command: {
        type: 'STRING',
        description: 'Shell command to execute (runs via bash -lc)',
      },
      timeout_seconds: {
        type: 'INTEGER',
        description: 'Maximum runtime in seconds (default 60, max 300)',
      },
      max_stdout_bytes: {
        type: 'INTEGER',
        description: 'Maximum stdout bytes to capture (default 131072, max 1048576)',
      },
      max_stderr_bytes: {
        type: 'INTEGER',
        description: 'Maximum stderr bytes to capture (default 65536, max 524288)',
      },
    },
    required: ['command'],
  },
};

function boundedInt(value: any, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function executeShellCommand(args: {
  command: string;
  timeout_seconds?: number;
  max_stdout_bytes?: number;
  max_stderr_bytes?: number;
}): Promise<any> {
  const userId = requireUserId();
  const parentJob = getParentJobContext();
  const conversationId = parentJob?.jobInput?.conversationId;

  if (!conversationId || !parentJob) {
    return { error: 'Cannot execute command without active conversation job context.' };
  }

  const command = (args.command || '').trim();
  if (!command) {
    return { error: 'Command is required.' };
  }

  const timeoutMs = boundedInt(args.timeout_seconds, 60, 1, 300) * 1000;
  const maxStdoutBytes = boundedInt(args.max_stdout_bytes, 131072, 4096, 1048576);
  const maxStderrBytes = boundedInt(args.max_stderr_bytes, 65536, 4096, 524288);
  const toolContext = getToolContext();
  const toolCallId = typeof toolContext?.toolCallId === 'string' ? toolContext.toolCallId : undefined;

  // Pass app context to the shell worker if present (gives access to app dir + secrets)
  const appContext = toolContext?.appContext as { appId: string; appSecrets: Record<string, string> } | undefined;

  const job = await createAndStartToolJob('shell-command', {
    command,
    timeoutMs,
    maxStdoutBytes,
    maxStderrBytes,
    userId,
    ...(appContext ? { appId: appContext.appId, appSecrets: appContext.appSecrets } : {}),
  }, userId);

  await emitToolJobEvent(job.id, shellCommandDefinition.name, conversationId, { command, callId: toolCallId });

  const noYield = toolContext?.noYield === true;

  if (noYield) {
    // Simple path: no yield system, just wait up to 60 seconds
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

export const shellCommandTools: Tool[] = [
  {
    definition: shellCommandDefinition,
    execute: executeShellCommand,
    getResultEventExtra: (result: any) => {
      if (result?.async_job_id) return { async_job_id: result.async_job_id };
      return {};
    },
  },
];
