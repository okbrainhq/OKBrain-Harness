import { AIStreamChunk } from '../types';
import { StreamSanitizer } from '../utils';
import { ThinkTagParser } from './think-parser';
import { fetchWithRetry } from './fetch-retry';

/** Stateful text filter (e.g. FunctionCallTagSanitizer for Qwen models) */
export interface ContentFilter {
  process(text: string): string;
  flush(): string;
}

export interface OpenAIStreamConfig {
  url: string;
  headers: Record<string, string>;
  model: string;
  messages: any[];
  tools?: any[];
  providerName: string;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  /** Extra fields merged into the request body */
  extraBody?: Record<string, any>;
  /** Optional stateful filter applied to text before prefix sanitization */
  contentFilter?: ContentFilter;
}

export interface OpenAIStreamResult {
  text: string;
  thoughts: string;
  toolCalls: Array<{ id: string; name: string; arguments: any }>;
  usage: any;
  finishReason: string;
}

/**
 * Performs a single streaming request to an OpenAI-compatible API.
 * Parses SSE chunks, accumulates tool calls, and separates <think> blocks.
 */
export async function openaiStreamRound(
  config: OpenAIStreamConfig,
  onChunk: (chunk: AIStreamChunk) => void | Promise<void>,
): Promise<OpenAIStreamResult> {
  const body: any = {
    model: config.model,
    messages: config.messages,
    stream: true,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...config.extraBody,
  };

  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools;
  }

  const response = await fetchWithRetry(
    config.url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...config.headers,
      },
      body: JSON.stringify(body),
      signal: config.signal,
    },
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  let accumulatedText = '';
  let accumulatedThoughts = '';
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = '';
  let usage: any = null;

  const thinkParser = new ThinkTagParser();
  const sanitizer = new StreamSanitizer(config.providerName);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(trimmed.startsWith('data: ') ? 6 : 5).trim();
      if (data === '[DONE]') continue;

      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }

      if (chunk.usage) {
        usage = chunk.usage;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;
      if (!delta) continue;

      // Accumulate streamed tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
              id: tc.id || `call_${idx}_${Date.now()}`,
              name: tc.function?.name || '',
              arguments: '',
            });
          }
          const entry = toolCallsMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }

      // Handle dedicated reasoning field (providers use different names)
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (reasoning) {
        accumulatedThoughts += reasoning;
        await onChunk({ text: '', thought: reasoning, done: false });
      }

      // Handle content — separate <think> blocks from visible text
      if (delta.content) {
        const parsed = thinkParser.process(delta.content);

        if (parsed.thought) {
          accumulatedThoughts += parsed.thought;
          await onChunk({ text: '', thought: parsed.thought, done: false });
        }

        if (parsed.text) {
          const filtered = config.contentFilter ? config.contentFilter.process(parsed.text) : parsed.text;
          if (filtered) {
            const sanitizedText = sanitizer.process(filtered);
            if (sanitizedText) {
              accumulatedText += sanitizedText;
              await onChunk({ text: sanitizedText, done: false });
            }
          }
        }
      }
    }
  }

  // Flush think parser
  const thinkRemaining = thinkParser.flush();
  if (thinkRemaining.thought) {
    accumulatedThoughts += thinkRemaining.thought;
    await onChunk({ text: '', thought: thinkRemaining.thought, done: false });
  }
  if (thinkRemaining.text) {
    const filtered = config.contentFilter ? config.contentFilter.process(thinkRemaining.text) : thinkRemaining.text;
    if (filtered) {
      const sanitizedText = sanitizer.process(filtered);
      if (sanitizedText) {
        accumulatedText += sanitizedText;
        await onChunk({ text: sanitizedText, done: false });
      }
    }
  }

  // Flush content filter
  if (config.contentFilter) {
    const filterRemaining = config.contentFilter.flush();
    if (filterRemaining) {
      const sanitizedText = sanitizer.process(filterRemaining);
      if (sanitizedText) {
        accumulatedText += sanitizedText;
        await onChunk({ text: sanitizedText, done: false });
      }
    }
  }

  // Flush prefix sanitizer
  const sanitizerRemaining = sanitizer.flush();
  if (sanitizerRemaining) {
    accumulatedText += sanitizerRemaining;
    await onChunk({ text: sanitizerRemaining, done: false });
  }

  // Parse accumulated tool call argument strings into objects
  const toolCalls: Array<{ id: string; name: string; arguments: any }> = [];
  for (const tc of toolCallsMap.values()) {
    let args: any = {};
    if (tc.arguments) {
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        console.warn(`[openaiStreamRound] Failed to parse tool call arguments for ${tc.name}:`, tc.arguments);
      }
    }
    toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
  }

  return { text: accumulatedText, thoughts: accumulatedThoughts, toolCalls, usage, finishReason };
}
