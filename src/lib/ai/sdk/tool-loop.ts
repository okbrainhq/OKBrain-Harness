import { AIStreamChunk } from '../types';
import { executeToolCalls } from './tool-runner';
import type { ToolResult } from './tool-runner';

export interface StreamRoundResult {
  text: string;
  thoughts: string;
  toolCalls: Array<{ id?: string; name: string; arguments: any }>;
  usage: any;
  finishReason: string | null;
  /** Provider-specific data (e.g. Anthropic contentBlocks) passed to buildAssistantMessage */
  extra?: any;
}

export interface CompactionConfig {
  tokenLimit: number;
  getInputTokens: (usage: any) => number;
  generateSummary: (messages: any[]) => Promise<string>;
  onCompaction: (summary: string, tokensBefore: number) => void | Promise<void>;
}

export interface ToolLoopConfig {
  providerName: string;
  onChunk: (chunk: AIStreamChunk) => void | Promise<void>;
  messages: any[];
  tools: any[];
  maxToolRounds?: number;
  compaction?: CompactionConfig;
  executeContext: {
    userId?: string;
    conversationId?: string;
    parentJobId?: string;
    appContext?: any;
  };
  streamRound: (messages: any[], tools: any[] | undefined) => Promise<StreamRoundResult>;
  buildAssistantMessage: (result: StreamRoundResult) => any;
  buildToolResultMessages: (toolResults: ToolResult[]) => any[];
  logUsage?: (usage: any) => void;
}

// Error classification for retry logic
function isRetryableError(error: any): boolean {
  const msg = (error?.message || '').toLowerCase();
  const code = error?.code || '';
  const status = error?.status || error?.statusCode || 0;

  // Network errors — always retryable
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return true;
  if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('socket')) return true;

  // HTTP status codes
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) return true;
  if (msg.includes('rate limit') || msg.includes('overloaded') || msg.includes('at capacity')) return true;
  if (msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) return true;

  return false;
}

function isNetworkError(error: any): boolean {
  const code = error?.code || '';
  const msg = (error?.message || '').toLowerCase();
  return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
    || msg.includes('fetch failed') || msg.includes('network') || msg.includes('socket');
}

function getRetryAfterMs(error: any): number | null {
  const headers = error?.headers || error?.response?.headers;
  if (!headers) return null;
  const retryAfter = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  if (!retryAfter) return null;
  const seconds = parseInt(retryAfter, 10);
  return isNaN(seconds) ? null : seconds * 1000;
}

const BACKOFF_SCHEDULE = [0, 5000, 15000, 30000, 60000]; // immediate, 5s, 15s, 30s, 60s

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs the main AI tool loop: stream → execute tools → repeat until done.
 * Used by: xAI, Anthropic, Fireworks, OpenRouter adapters.
 * NOT used by: Gemini (own recursive loop) and Ollama (own for-loop).
 *
 * When `compaction` is configured, the loop runs indefinitely (no round limit).
 * When input tokens exceed the threshold, conversation history is summarized
 * and replaced, allowing the loop to continue with fresh context.
 *
 * When `compaction` is not configured, falls back to `maxToolRounds` (default 50)
 * as a safety limit, matching the legacy behavior.
 */
export async function runToolLoop(config: ToolLoopConfig): Promise<void> {
  let allThoughts = '';
  let hasText = false;
  let lastToolCalls: Array<{ id?: string; name: string; arguments: any }> = [];
  let lastFinishReason: string | undefined;
  let compactionCount = 0;
  let lastInputTokens = 0;
  let round = 0;

  // If no compaction, use maxToolRounds as a safety limit (backward compat)
  const maxRounds = config.compaction ? Infinity : (config.maxToolRounds ?? 50);

  while (round <= maxRounds) {
    round++;

    // Stream round with retry logic
    let result: StreamRoundResult;
    const maxAttempts = config.compaction ? 5 : 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const tools = (!config.compaction && round > maxRounds) ? undefined : config.tools;
        result = await config.streamRound(config.messages, tools);
        lastError = null;
        break;
      } catch (error: any) {
        lastError = error;

        // AbortError is never retryable
        if (error?.name === 'AbortError') throw error;

        if (!isRetryableError(error) || attempt === maxAttempts) {
          throw error;
        }

        // Network errors get all 5 attempts, other retryable errors get 3
        if (!isNetworkError(error) && attempt >= 3) {
          throw error;
        }

        const retryAfterMs = getRetryAfterMs(error);
        const delayMs = retryAfterMs ?? BACKOFF_SCHEDULE[Math.min(attempt, BACKOFF_SCHEDULE.length - 1)];

        const errorMsg = error?.message?.slice(0, 100) || 'Unknown error';
        console.warn(`[${config.providerName}] Retrying (attempt ${attempt}/${maxAttempts}): ${errorMsg}`);
        await config.onChunk({
          text: '',
          done: false,
          status: `Retrying after error (attempt ${attempt}/${maxAttempts}): ${errorMsg}`,
        });

        if (delayMs > 0) await sleep(delayMs);
      }
    }

    // TypeScript: result is assigned if we didn't throw
    result = result!;

    allThoughts += result.thoughts;
    if (result.text) hasText = true;
    if (result.usage && config.logUsage) config.logUsage(result.usage);
    if (result.usage) {
      const tokenGetter = config.compaction?.getInputTokens;
      if (tokenGetter) lastInputTokens = tokenGetter(result.usage);
    }

    lastFinishReason = result.finishReason || undefined;
    console.log(`[${config.providerName}] round=${round} finishReason:`, result.finishReason, 'toolCalls:', result.toolCalls.length, 'tokens:', lastInputTokens);

    // Natural stop — model has no more tool calls
    if (result.toolCalls.length === 0) {
      lastToolCalls = [];
      break;
    }

    // Check if compaction is needed (only when there are tool calls to continue with)
    if (config.compaction && lastInputTokens > config.compaction.tokenLimit) {
      await config.onChunk({ text: '', done: false, status: 'Compacting context...' });
      console.log(`[${config.providerName}] Compacting at ${lastInputTokens} tokens (limit: ${config.compaction.tokenLimit})`);

      // Separate system messages (role === 'system') from conversation
      const systemMsgs = config.messages.filter(m => m.role === 'system');
      const conversationMsgs = config.messages.filter(m => m.role !== 'system');

      let summary = '';
      try {
        summary = await config.compaction.generateSummary(conversationMsgs);
      } catch (error) {
        console.warn(`[${config.providerName}] Compaction summary failed, skipping this round:`, error);
        // Don't compact — continue the loop and try again next round
      }

      if (summary) {
        // Replace messages with system + summary pair
        config.messages.length = 0;
        config.messages.push(...systemMsgs);
        config.messages.push({
          role: 'user',
          content: `[Previous conversation context]\n${summary}`,
        });
        config.messages.push({
          role: 'assistant',
          content: 'Understood. Continuing from the compacted context.',
        });

        compactionCount++;
        await config.compaction.onCompaction(summary, lastInputTokens);
        allThoughts = ''; // Reset thoughts — belongs to pre-compaction context

        // Re-add the assistant message + execute tool calls after compaction
        config.messages.push(config.buildAssistantMessage(result));

        const toolResults = await executeToolCalls(
          result.toolCalls,
          config.providerName,
          config.onChunk,
          config.executeContext,
        );

        const resultMsgs = config.buildToolResultMessages(toolResults);
        for (const msg of resultMsgs) {
          config.messages.push(msg);
        }
        lastToolCalls = result.toolCalls;

        continue;
      }
    }

    config.messages.push(config.buildAssistantMessage(result));

    const toolResults = await executeToolCalls(
      result.toolCalls,
      config.providerName,
      config.onChunk,
      config.executeContext,
    );

    const resultMsgs = config.buildToolResultMessages(toolResults);
    for (const msg of resultMsgs) {
      config.messages.push(msg);
    }

    lastToolCalls = result.toolCalls;

    // Emit periodic status for long-running loops
    if (config.compaction && round % 5 === 0) {
      const tokenStr = lastInputTokens ? ` (${lastInputTokens.toLocaleString()} tokens)` : '';
      const compactStr = compactionCount > 0 ? `, ${compactionCount} compaction${compactionCount !== 1 ? 's' : ''}` : '';
      await config.onChunk({
        text: '',
        done: false,
        status: `Round ${round}${tokenStr}${compactStr}`,
      });
    }
  }

  if (!hasText) {
    console.warn(`[${config.providerName}] Empty text response. thoughtLen=${allThoughts.length}`);
  }

  await config.onChunk({
    text: '',
    done: true,
    finishReason: lastFinishReason,
    toolCalls: lastToolCalls.length > 0
      ? lastToolCalls.map(tc => ({ id: tc.id || '', name: tc.name, arguments: tc.arguments, result: null }))
      : undefined,
    ...(allThoughts ? { thought: allThoughts } : {}),
  });
}

// --- OpenAI-format helpers ---

export function buildOpenAIAssistantMessage(result: StreamRoundResult): any {
  return {
    role: 'assistant',
    content: result.text || null,
    tool_calls: result.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    })),
  };
}

export function buildOpenAIToolResultMessages(toolResults: ToolResult[]): any[] {
  return toolResults.map(tr => ({
    role: 'tool',
    tool_call_id: tr.id,
    content: JSON.stringify(tr.result),
  }));
}

// --- Anthropic-format helpers ---

export function buildAnthropicAssistantMessage(result: StreamRoundResult): any {
  const contentBlocks = result.extra?.contentBlocks || [];
  return {
    role: 'assistant',
    content: contentBlocks.map((block: any) => {
      if (block.type === 'thinking') {
        return { type: 'thinking', thinking: block.thinking || '', signature: block.signature || '' };
      } else if (block.type === 'text') {
        return { type: 'text', text: block.text || '' };
      } else {
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }
    }),
  };
}

export function buildAnthropicToolResultMessages(toolResults: ToolResult[]): any[] {
  return [{
    role: 'user',
    content: toolResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.id,
      content: JSON.stringify(tr.result),
    })),
  }];
}
