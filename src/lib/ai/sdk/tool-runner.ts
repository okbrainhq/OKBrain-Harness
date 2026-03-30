import { AIStreamChunk } from '../types';
import { executeTool, getToolStatusMessage } from '../tools';
import { runWithToolContext } from '../tools/context';

export interface ToolCallEntry {
  id?: string;
  name: string;
  arguments: any;
}

export interface ToolResult {
  id?: string;
  name: string;
  arguments: any;
  result: any;
}

export interface ExecuteToolCallsOptions {
  userId?: string;
  conversationId?: string;
  parentJobId?: string;
  appContext?: any;
  noYield?: boolean;
  /** Skip tool calls that don't pass this filter */
  filterFn?: (name: string) => boolean;
  /** Transform arguments before execution (e.g. normalize for small models) */
  normalizeArgs?: (name: string, args: any) => any;
}

/**
 * Executes a list of tool calls, streaming status messages via onChunk.
 * Returns results in order (only for tool calls that passed the filter).
 */
export async function executeToolCalls(
  toolCalls: ToolCallEntry[],
  providerName: string,
  onChunk: (chunk: AIStreamChunk) => void | Promise<void>,
  options?: ExecuteToolCallsOptions,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const shortName = providerName.split(' ')[0];

  for (const tc of toolCalls) {
    if (options?.filterFn && !options.filterFn(tc.name)) continue;

    await onChunk({ text: '', status: getToolStatusMessage(tc.name), done: false });

    const args = options?.normalizeArgs
      ? options.normalizeArgs(tc.name, tc.arguments)
      : tc.arguments;

    const result = await runWithToolContext(
      {
        userId: options?.userId,
        conversationId: options?.conversationId,
        parentJobId: options?.parentJobId,
        appContext: options?.appContext,
        noYield: options?.noYield,
      },
      () => executeTool(tc.name, args),
    );

    results.push({ id: tc.id, name: tc.name, arguments: tc.arguments, result });

    await onChunk({ text: '', status: `Talking to ${shortName}`, done: false });
  }

  return results;
}
