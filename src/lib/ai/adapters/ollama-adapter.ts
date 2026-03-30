import { AIProvider, AIMessage, AIStreamChunk, AIGenerateOptions } from "../types";
import { streamOllama, OllamaMessage } from "../ollama-api";
import { buildTimeContext } from "../system-prompts";
import { resolveLocalFileToBase64 } from "../local-file-api";
import { allTools } from "../tools";
import { executeToolCalls } from '../sdk';

const OLLAMA_TOOL_NAMES = [
  'internet_search',
  'search_events',
  'get_events_by_date_range',
  'get_upcoming_events',
  'get_past_events',
  'get_event',
  'create_event',
  'update_event',
  'delete_event',
  'run_shell_command',
  'shell_image_upload',
  'discover_apps',
  'app_info',
  'run_app',
];

// Simplified parameter schemas for small models
const PARAM_OVERRIDES: Record<string, any> = {
  internet_search: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Search queries to execute',
      },
    },
    required: ['queries'],
  },
  create_event: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start_datetime: { type: 'string', description: 'Start time in UTC ISO 8601 (e.g. 2026-03-10T14:00:00Z)' },
            end_datetime: { type: 'string', description: 'End time in UTC ISO 8601. Optional.' },
            description: { type: 'string', description: 'Event description. Optional.' },
            location: { type: 'string', description: 'Event location. Optional.' },
          },
          required: ['title', 'start_datetime'],
        },
        description: 'Array of events to create',
      },
    },
    required: ['events'],
  },
  update_event: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event_id: { type: 'string', description: 'ID of the event to update' },
            title: { type: 'string', description: 'Event title' },
            start_datetime: { type: 'string', description: 'Start time in UTC ISO 8601 (e.g. 2026-03-10T14:00:00Z)' },
            end_datetime: { type: 'string', description: 'End time in UTC ISO 8601. Optional.' },
            description: { type: 'string', description: 'Event description. Optional.' },
            location: { type: 'string', description: 'Event location. Optional.' },
          },
          required: ['event_id', 'title', 'start_datetime'],
        },
        description: 'Array of event updates',
      },
    },
    required: ['events'],
  },
  run_shell_command: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute (runs via bash -lc)',
      },
    },
    required: ['command'],
  },
  shell_image_upload: {
    type: 'object',
    properties: {
      filenames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filenames to upload from /home/brain-sandbox/upload_images/',
      },
    },
    required: ['filenames'],
  },
};

function buildOllamaTools(excludeTools?: string[]): any[] {
  return allTools
    .filter(t => OLLAMA_TOOL_NAMES.includes(t.definition.name))
    .filter(t => !excludeTools?.includes(t.definition.name))
    .map(t => ({
      type: 'function',
      function: {
        name: t.definition.name,
        description: t.definition.shortDescription || t.definition.description,
        parameters: PARAM_OVERRIDES[t.definition.name] || convertParams(t.definition.parameters),
      },
    }));
}

// Convert our UPPERCASE type format to JSON Schema for Ollama
function convertParams(params: any): any {
  if (!params) return { type: 'object', properties: {} };
  const props: Record<string, any> = {};
  if (params.properties) {
    for (const [key, val] of Object.entries(params.properties) as any[]) {
      props[key] = convertParamType(val);
    }
  }
  return {
    type: 'object',
    properties: props,
    ...(params.required ? { required: params.required } : {}),
  };
}

function convertParamType(param: any): any {
  const type = (param.type || 'string').toLowerCase();
  const result: any = { type };
  if (param.description) result.description = param.description;
  if (type === 'object' && param.properties) {
    Object.assign(result, convertParams(param));
  }
  if (type === 'array' && param.items) {
    result.items = convertParamType(param.items);
  }
  return result;
}

// Normalize tool args to the format executeTool expects
function normalizeToolArgs(toolName: string, args: any): any {
  if (toolName === 'internet_search') {
    const queries: string[] = args.queries || args.searches || [];
    return {
      searches: queries.map((q: any) =>
        typeof q === 'string' ? { query: q } : q
      ),
    };
  }
  if (toolName === 'shell_image_upload') {
    // Model produces { filenames: ["a.png"] }
    // executeTool expects { files: [{ filename: "a.png" }] }
    const filenames: string[] = args.filenames || args.files || [];
    return {
      files: filenames.map((f: any) =>
        typeof f === 'string' ? { filename: f } : f
      ),
    };
  }
  // run_shell_command args pass through as-is
  return args;
}

// Parse XML-style tool calls that small models sometimes emit as text
// e.g. <tool_call> <function=get_events_by_date_range> <parameter=start_date>2026-03-07T00:00:00Z</parameter> </function> </tool_call>
function parseTextToolCalls(text: string): any[] {
  const toolCallRegex = /<tool_call>\s*<function=(\w+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  const paramRegex = /<parameter=(\w+)>\s*([\s\S]*?)\s*<\/parameter>/g;
  const results: any[] = [];

  let match;
  while ((match = toolCallRegex.exec(text)) !== null) {
    const funcName = match[1];
    const body = match[2];
    const args: Record<string, string> = {};

    let paramMatch;
    paramRegex.lastIndex = 0;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }

    if (OLLAMA_TOOL_NAMES.includes(funcName)) {
      results.push({ function: { name: funcName, arguments: args } });
    }
  }

  return results;
}

export class OllamaProvider implements AIProvider {
  name: string;
  private baseURL: string;
  private modelName: string;
  private thinking: boolean;

  constructor(baseURL: string, modelName: string, displayName?: string, thinking?: boolean) {
    this.baseURL = baseURL;
    this.modelName = modelName;
    this.name = displayName || "Qwen 3.5";
    this.thinking = thinking ?? true;
  }

  getModelName(): string {
    return this.name;
  }

  async generateStream(
    messages: AIMessage[],
    onChunk: (chunk: AIStreamChunk) => void,
    options?: AIGenerateOptions
  ): Promise<void> {
    const emojiRule = '\nUse emojis liberally to make responses engaging and visually scannable. Place a relevant emoji at the start of headers, section titles, and key bullet points. Choose emojis that match the content.';
    const systemPrompt = options?.mode === 'quick'
      ? 'You are a helpful assistant. Give short, direct answers.\nWhen citing search results, always use [source](URL) — the word "source" is fixed, never use page titles.' + emojiRule
      : 'You are a helpful assistant.\nWhen citing search results, always use [source](URL) — the word "source" is fixed, never use page titles.' + emojiRule;

    const timeContext = buildTimeContext(options?.location);

    const ollamaMessages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((msg, index) => {
        let content = msg.content;
        // Inject time + location into the last user message
        if (index === messages.length - 1 && msg.role === 'user') {
          content = `${content}\n\n[Context: ${timeContext}]`;
        }

        // Collect base64 images for Ollama's images field
        const images: string[] = [];
        if (msg.image) {
          images.push(msg.image.base64);
        }
        if (msg.files && Array.isArray(msg.files)) {
          for (const file of msg.files) {
            const localFile = resolveLocalFileToBase64(file.fileUri, file.mimeType);
            if (localFile) {
              images.push(localFile.base64);
            }
          }
        }

        return {
          role: msg.role,
          content,
          ...(images.length > 0 ? { images } : {}),
        };
      }),
    ];

    let allThoughts = '';
    // Ollama uses its own tool loop (not runToolLoop from the SDK).
    // This means it does NOT support infinite looping or context compaction.
    // It has a fixed round limit and falls back to the observer summary
    // in chat-worker.ts when the limit is hit.
    // TODO: Migrate to runToolLoop with compaction support.
    const MAX_TOOL_ROUNDS = 10;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let toolCalls: any[] = [];
        let accumulatedContent = '';

        await streamOllama(
          {
            model: this.modelName,
            messages: ollamaMessages,
            think: this.thinking,
            tools: round < MAX_TOOL_ROUNDS ? buildOllamaTools(options?.excludeTools) : undefined,
            signal: options?.signal,
          },
          async (chunk) => {
            if (chunk.thinking) {
              allThoughts += chunk.thinking;
              await onChunk({ text: '', thought: chunk.thinking, done: false });
            }
            if (chunk.content) {
              accumulatedContent += chunk.content;
              await onChunk({ text: chunk.content, done: false });
            }
            if (chunk.toolCalls) {
              toolCalls.push(...chunk.toolCalls);
            }
            if (chunk.promptTokens !== undefined) {
              console.log(`[Ollama] model=${this.modelName} round=${round} prompt=${chunk.promptTokens} output=${chunk.outputTokens}`);
            }
          }
        );

        // Parse XML-style tool calls from content (small models sometimes do this)
        if (toolCalls.length === 0 && accumulatedContent) {
          const parsed = parseTextToolCalls(accumulatedContent);
          if (parsed.length > 0) {
            toolCalls = parsed;
          }
        }

        // No tool calls — we're done
        if (toolCalls.length === 0) {
          break;
        }

        // Add the assistant's tool call message to history
        ollamaMessages.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCalls,
        });

        // Map Ollama tool call format to standard ToolCallEntry format and execute
        const standardToolCalls = toolCalls.map(tc => ({
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || {},
        }));

        const toolResults = await executeToolCalls(
          standardToolCalls,
          this.name,
          onChunk,
          {
            userId: options?.userId,
            conversationId: options?.conversationId,
            parentJobId: options?.parentJobId,
            appContext: options?.appContext,
            noYield: true,
            filterFn: (name) => OLLAMA_TOOL_NAMES.includes(name) && !options?.excludeTools?.includes(name),
            normalizeArgs: normalizeToolArgs,
          },
        );

        // Add tool results to Ollama message history
        for (const tr of toolResults) {
          ollamaMessages.push({
            role: 'tool',
            content: JSON.stringify(tr.result),
          });
        }
      }

      await onChunk({
        text: '',
        done: true,
        ...(allThoughts ? { thought: allThoughts } : {}),
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Ollama stream aborted by signal');
        return;
      }

      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
        throw new Error('Ollama is not running. Please start Ollama and try again.');
      }

      console.error('Ollama API error:', error);
      throw new Error(`Ollama generation failed: ${error.message || 'Unknown error'}`);
    }
  }

}
