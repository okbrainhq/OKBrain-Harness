import { AIStreamChunk } from '../types';
import { StreamSanitizer } from '../utils';
import { fetchWithRetry } from './fetch-retry';

/** A content block produced by the model (for rebuilding history in tool loops) */
export interface AnthropicContentBlock {
  type: 'thinking' | 'text' | 'tool_use';
  // thinking
  thinking?: string;
  signature?: string;
  // text
  text?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: any;
}

export interface AnthropicStreamConfig {
  apiKey: string;
  model: string;
  system: any;
  messages: any[];
  tools?: any[];
  signal?: AbortSignal;
  providerName: string;
  maxTokens?: number;
  thinking?: { type: 'enabled'; budget_tokens: number };
}

export interface AnthropicStreamResult {
  text: string;
  thoughts: string;
  toolCalls: Array<{ id: string; name: string; arguments: any }>;
  usage: any;
  stopReason: string;
  /** Raw content blocks for rebuilding assistant message in tool loop history */
  contentBlocks: AnthropicContentBlock[];
}

/**
 * Performs a single streaming request to the Anthropic Messages API.
 * Parses Anthropic SSE events (content_block_start/delta/stop, message_start/delta/stop).
 */
export async function anthropicStreamRound(
  config: AnthropicStreamConfig,
  onChunk: (chunk: AIStreamChunk) => void | Promise<void>,
): Promise<AnthropicStreamResult> {
  const body: any = {
    model: config.model,
    max_tokens: config.maxTokens || 8192,
    system: config.system,
    messages: config.messages,
    stream: true,
  };

  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools;
  }

  if (config.thinking) {
    body.thinking = config.thinking;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  };

  if (config.thinking) {
    headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
  }

  const response = await fetchWithRetry(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: config.signal,
    },
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  let accumulatedText = '';
  let accumulatedThoughts = '';
  let stopReason = '';
  let usage: any = {};

  // Track content blocks by index for history reconstruction
  const blockMap = new Map<number, AnthropicContentBlock>();

  const sanitizer = new StreamSanitizer(config.providerName);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('event:')) continue;
      if (!trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(trimmed.startsWith('data: ') ? 6 : 5).trim();
      if (!data) continue;

      let event: any;
      try { event = JSON.parse(data); } catch { continue; }

      switch (event.type) {
        case 'message_start':
          if (event.message?.usage) {
            usage = { ...usage, ...event.message.usage };
          }
          break;

        case 'content_block_start': {
          const block = event.content_block;
          if (block?.type === 'thinking') {
            blockMap.set(event.index, { type: 'thinking', thinking: '', signature: '' });
          } else if (block?.type === 'text') {
            blockMap.set(event.index, { type: 'text', text: '' });
          } else if (block?.type === 'tool_use') {
            blockMap.set(event.index, {
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: '',
            });
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta;
          const block = blockMap.get(event.index);

          if (delta?.type === 'thinking_delta') {
            accumulatedThoughts += delta.thinking;
            if (block) block.thinking = (block.thinking || '') + delta.thinking;
            await onChunk({ text: '', thought: delta.thinking, done: false });
          } else if (delta?.type === 'signature_delta') {
            if (block) block.signature = (block.signature || '') + delta.signature;
          } else if (delta?.type === 'text_delta') {
            const sanitizedText = sanitizer.process(delta.text);
            if (sanitizedText) {
              accumulatedText += sanitizedText;
              if (block) block.text = (block.text || '') + delta.text;
              await onChunk({ text: sanitizedText, done: false });
            } else {
              // Still accumulate raw text in block even if sanitizer buffers it
              if (block) block.text = (block.text || '') + delta.text;
            }
          } else if (delta?.type === 'input_json_delta') {
            if (block) block.input = (block.input || '') + delta.partial_json;
          }
          break;
        }

        case 'message_delta':
          if (event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
          if (event.usage) {
            usage = { ...usage, ...event.usage };
          }
          break;
      }
    }
  }

  // Flush sanitizer
  const sanitizerRemaining = sanitizer.flush();
  if (sanitizerRemaining) {
    accumulatedText += sanitizerRemaining;
    await onChunk({ text: sanitizerRemaining, done: false });
  }

  // Build content blocks and tool calls from tracked blocks
  const contentBlocks: AnthropicContentBlock[] = [];
  const toolCalls: Array<{ id: string; name: string; arguments: any }> = [];

  // Sort by index to maintain order
  const sortedEntries = [...blockMap.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, block] of sortedEntries) {
    if (block.type === 'thinking') {
      contentBlocks.push({
        type: 'thinking',
        thinking: block.thinking || '',
        signature: block.signature || '',
      });
    } else if (block.type === 'text') {
      contentBlocks.push({ type: 'text', text: block.text || '' });
    } else if (block.type === 'tool_use') {
      let args: any = {};
      if (block.input) {
        try {
          args = JSON.parse(block.input as string);
        } catch {
          console.warn(`[anthropicStreamRound] Failed to parse tool call arguments for ${block.name}:`, block.input);
        }
      }
      contentBlocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: args,
      });
      toolCalls.push({ id: block.id!, name: block.name!, arguments: args });
    }
  }

  return {
    text: accumulatedText,
    thoughts: accumulatedThoughts,
    toolCalls,
    usage,
    stopReason,
    contentBlocks,
  };
}
