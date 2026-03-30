import { Tool, ToolDefinition } from './types';
import { getToolContext } from './context';
import { getToolCallLogsByToolCallIds } from '../../db';

const retrieveToolResponsesDefinition: ToolDefinition = {
  name: 'retrieve_tool_responses',
  description: 'Retrieve previously executed tool call responses for this conversation by tool_call_id values.',
  parameters: {
    type: 'OBJECT',
    properties: {
      tool_call_ids: {
        type: 'ARRAY',
        items: {
          type: 'STRING',
        },
        description: 'Tool call sequence IDs to retrieve, e.g. ["001", "005"].',
      },
    },
    required: ['tool_call_ids'],
  },
};

function tryParseJson(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function executeRetrieveToolResponses(args: { tool_call_ids?: string[] }): Promise<any> {
  const context = getToolContext();
  const conversationId = context?.conversationId;
  if (!conversationId) {
    return { error: 'Conversation context is required to retrieve tool responses.' };
  }

  const requestedIds = Array.isArray(args?.tool_call_ids)
    ? args.tool_call_ids
      .map((id) => String(id).trim())
      .filter(Boolean)
    : [];

  if (requestedIds.length === 0) {
    return { error: 'tool_call_ids is required and must contain at least one ID.' };
  }

  const logs = await getToolCallLogsByToolCallIds(conversationId, requestedIds);
  return {
    results: logs.map((log) => ({
      tool_call_id: log.tool_call_id,
      tool_name: log.tool_name,
      status: log.status,
      arguments: tryParseJson(log.arguments),
      response: tryParseJson(log.response),
      error: log.error,
      created_at: log.created_at,
    })),
  };
}

export const toolCallRetrievalTools: Tool[] = [
  { definition: retrieveToolResponsesDefinition, execute: executeRetrieveToolResponses },
];
