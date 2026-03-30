import { Tool, ToolDefinition } from './types';
import { getToolContext } from './context';
import {
  getConversationToolJobByJobId,
  getToolCallLogByToolCallId,
  updateConversationToolJobState,
  updateToolCallLogResult,
} from '../../db';
import { getJob, stopJob } from '../../jobs';

const killToolCallJobDefinition: ToolDefinition = {
  name: 'kill_tool_call_job',
  description: 'Stop a currently yielded job-backed tool call in this conversation.',
  parameters: {
    type: 'OBJECT',
    properties: {
      tool_call_id: {
        type: 'STRING',
        description: 'Tool call sequence ID to stop, e.g. "003".',
      },
      signal: {
        type: 'STRING',
        enum: ['TERM', 'KILL'],
        description: 'Requested stop signal. Defaults to TERM.',
      },
      reason: {
        type: 'STRING',
        description: 'Optional reason for stopping this tool call.',
      },
    },
    required: ['tool_call_id'],
  },
};

function isTerminalLogStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed';
}

function isTerminalJobState(state: string | null | undefined): boolean {
  if (!state) return false;
  return ['succeeded', 'failed', 'stopped', 'timeout'].includes(state);
}

async function executeKillToolCallJob(args: {
  tool_call_id?: string;
  signal?: 'TERM' | 'KILL';
  reason?: string;
}): Promise<any> {
  const context = getToolContext();
  const conversationId = context?.conversationId;
  if (!conversationId) {
    return { error: 'Conversation context is required for kill_tool_call_job.' };
  }

  const toolCallId = String(args?.tool_call_id || '').trim();
  if (!toolCallId) {
    return { error: 'tool_call_id is required.' };
  }

  const requestedSignal = String(args?.signal || 'TERM').toUpperCase();
  const appliedSignal: 'TERM' | 'KILL' = requestedSignal === 'KILL' ? 'KILL' : 'TERM';
  const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';

  const log = await getToolCallLogByToolCallId(conversationId, toolCallId);
  if (!log) {
    return {
      tool_call_id: toolCallId,
      no_op: true,
      error: `Tool call '${toolCallId}' was not found in this conversation.`,
    };
  }

  const asyncJobId = log.async_job_id;
  const previousStatus = log.status;
  if (!asyncJobId) {
    return {
      tool_call_id: toolCallId,
      tool_name: log.tool_name,
      previous_status: previousStatus,
      final_status: previousStatus,
      no_op: true,
      message: isTerminalLogStatus(previousStatus)
        ? 'Tool call is already terminal.'
        : 'Tool call is not a yielded async job.',
      applied_signal: appliedSignal,
    };
  }

  const [jobBefore, toolJobBefore] = await Promise.all([
    getJob(asyncJobId),
    getConversationToolJobByJobId(asyncJobId),
  ]);

  const previousJobState = toolJobBefore?.state || jobBefore?.state || null;
  const alreadyTerminal = isTerminalLogStatus(previousStatus) || isTerminalJobState(previousJobState);
  if (alreadyTerminal) {
    return {
      tool_call_id: toolCallId,
      tool_name: log.tool_name,
      async_job_id: asyncJobId,
      previous_status: previousStatus,
      previous_job_state: previousJobState,
      final_status: isTerminalLogStatus(previousStatus) ? previousStatus : 'failed',
      final_job_state: previousJobState,
      no_op: true,
      applied_signal: appliedSignal,
      message: 'Tool call is already terminal.',
    };
  }

  await stopJob(asyncJobId);
  if (appliedSignal === 'KILL') {
    // Best-effort escalation hint; worker-level hard kill is tool-specific.
    await stopJob(asyncJobId);
  }

  const errorReason = reason
    ? `Stopped via kill_tool_call_job (${appliedSignal}): ${reason}`
    : `Stopped via kill_tool_call_job (${appliedSignal}).`;

  await updateToolCallLogResult(log.id, {
    status: 'failed',
    response: {
      status: 'stopped',
      applied_signal: appliedSignal,
      job_id: asyncJobId,
      reason: reason || null,
    },
    error: errorReason,
  });

  await updateConversationToolJobState(
    asyncJobId,
    'stopped',
    {
      status: 'stopped',
      applied_signal: appliedSignal,
      reason: reason || null,
    },
    errorReason
  );

  const [jobAfter, toolJobAfter] = await Promise.all([
    getJob(asyncJobId),
    getConversationToolJobByJobId(asyncJobId),
  ]);

  const finalJobState = toolJobAfter?.state || jobAfter?.state || 'stopped';

  console.log(
    '[kill_tool_call_job]',
    JSON.stringify({
      conversationId,
      toolCallId,
      asyncJobId,
      appliedSignal,
      reason: reason || null,
      previousStatus,
      previousJobState,
      finalJobState,
    })
  );

  return {
    tool_call_id: toolCallId,
    tool_name: log.tool_name,
    async_job_id: asyncJobId,
    previous_status: previousStatus,
    previous_job_state: previousJobState,
    final_status: 'failed',
    final_job_state: finalJobState,
    applied_signal: appliedSignal,
    no_op: false,
  };
}

export const killToolCallJobTools: Tool[] = [
  { definition: killToolCallJobDefinition, execute: executeKillToolCallJob },
];

