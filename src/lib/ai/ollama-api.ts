/**
 * Low-level Ollama API client.
 * Covers both one-shot completions and streaming chat requests.
 */

export interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: any[];
  images?: string[]; // Base64-encoded image data
}

export type QwenSamplingPreset = 'qwen3.5-thinking' | 'qwen3.5-non-thinking' | 'qwen3.5-reasoning';

export interface OllamaStreamRequest {
  model: string;
  messages: OllamaMessage[];
  think?: boolean;
  keepAlive?: string;
  tools?: any[];
  numCtx?: number;
  signal?: AbortSignal;
  /** Override sampling preset. Defaults based on think flag. */
  samplingPreset?: QwenSamplingPreset;
}

export interface OllamaStreamChunk {
  thinking?: string;
  content?: string;
  toolCalls?: any[];
  /** Set on the final chunk */
  promptTokens?: number;
  outputTokens?: number;
}

// Qwen 3.5 recommended sampling parameters
// https://huggingface.co/Qwen/Qwen3.5-9B#instruct-or-non-thinking-mode
function getSamplingOptions(preset: QwenSamplingPreset): Record<string, number> {
  switch (preset) {
    case 'qwen3.5-thinking':
      return { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repeat_penalty: 1.0 };
    case 'qwen3.5-non-thinking':
      return { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repeat_penalty: 1.0 };
    case 'qwen3.5-reasoning':
      return { temperature: 1.0, top_p: 1.0, top_k: 40, min_p: 0.0, presence_penalty: 2.0, repeat_penalty: 1.0 };
  }
}

/**
 * Streams a chat request to the Ollama /api/chat endpoint.
 * Calls onChunk for each parsed event; resolves when the stream ends.
 * Requires OLLAMA_URL to be set.
 */
export async function streamOllama(
  request: OllamaStreamRequest,
  onChunk: (chunk: OllamaStreamChunk) => Promise<void>
): Promise<void> {
  const baseURL = process.env.OLLAMA_URL;
  if (!baseURL) throw new Error('OLLAMA_URL is not set');

  const thinking = request.think ?? false;
  const preset = request.samplingPreset ?? (thinking ? 'qwen3.5-thinking' : 'qwen3.5-non-thinking');

  const body = {
    model: request.model,
    messages: request.messages,
    stream: true,
    think: thinking,
    keep_alive: request.keepAlive ?? '30m',
    ...(request.tools ? { tools: request.tools } : {}),
    options: { num_ctx: request.numCtx ?? 32768, ...getSamplingOptions(preset) },
  };

  const response = await fetch(`${baseURL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API error ${response.status}: ${errText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk: any;
      try { chunk = JSON.parse(line); } catch { continue; }

      const out: OllamaStreamChunk = {};
      if (chunk.message?.thinking) out.thinking = chunk.message.thinking;
      if (chunk.message?.content)  out.content  = chunk.message.content;
      if (chunk.message?.tool_calls) out.toolCalls = chunk.message.tool_calls;
      if (chunk.done) {
        out.promptTokens = chunk.prompt_eval_count ?? 0;
        out.outputTokens = chunk.eval_count ?? 0;
      }
      if (Object.keys(out).length > 0) await onChunk(out);
    }
  }
}

export interface OllamaCallOptions {
  model?: string;
  thinking?: boolean;
  keepAlive?: string;
  /** Override sampling preset. Defaults based on thinking flag. */
  samplingPreset?: QwenSamplingPreset;
}

export interface OllamaCallResult {
  text: string;
  thinking?: string;
  promptTokens: number;
  outputTokens: number;
}

// One-time per-model existence check (cached as a Promise to avoid races)
const modelExistenceCache = new Map<string, Promise<boolean>>();

/**
 * Checks whether a given model is available in Ollama. Result is cached for
 * the lifetime of the process so Ollama's /api/tags is only called once per model.
 */
export function checkOllamaModelExists(baseURL: string, model: string): Promise<boolean> {
  const key = `${baseURL}::${model}`;
  if (!modelExistenceCache.has(key)) {
    const promise = (async () => {
      try {
        const res = await fetch(`${baseURL}/api/tags`);
        if (!res.ok) {
          console.log(`[Ollama] /api/tags returned ${res.status} for ${baseURL}`);
          modelExistenceCache.delete(key); // don't cache failures
          return false;
        }
        const data = await res.json();
        const names: string[] = (data.models ?? []).map((m: any) => m.name as string);
        const exists = names.some(n => n === model || n === `${model}:latest`);
        if (!exists) {
          console.log(`[Ollama] Model ${model} not found. Available: ${names.join(', ')}`);
        }
        return exists;
      } catch (err) {
        console.log(`[Ollama] Failed to check model ${model} on ${baseURL}:`, err);
        modelExistenceCache.delete(key); // don't cache failures
        return false;
      }
    })();
    modelExistenceCache.set(key, promise);
  }
  return modelExistenceCache.get(key)!;
}

/**
 * Makes a non-streaming request to the Ollama /api/chat endpoint.
 * Requires OLLAMA_URL to be set.
 */
export async function callOllama(
  messages: OllamaMessage[],
  options?: OllamaCallOptions
): Promise<OllamaCallResult> {
  const baseURL = process.env.OLLAMA_URL;
  if (!baseURL) {
    throw new Error('OLLAMA_URL is not set');
  }

  const model = options?.model ?? 'qwen3.5:2b';
  const thinking = options?.thinking ?? true;
  const preset = options?.samplingPreset ?? (thinking ? 'qwen3.5-thinking' : 'qwen3.5-non-thinking');

  const body = {
    model,
    messages,
    stream: false,
    think: thinking,
    keep_alive: options?.keepAlive ?? '10m',
    options: getSamplingOptions(preset),
  };

  const response = await fetch(`${baseURL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = (data.message?.content ?? '').trim();
  const thought = (data.message?.thinking ?? '').trim();
  const promptTokens: number = data.prompt_eval_count ?? 0;
  const outputTokens: number = data.eval_count ?? 0;

  return { text, promptTokens, outputTokens, ...(thought ? { thinking: thought } : {}) };
}
