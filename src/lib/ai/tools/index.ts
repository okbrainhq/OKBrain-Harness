// Types
export * from './types';

// Formatters for different providers
export { toGeminiTools, toOpenAIToolDefinitions, toAnthropicToolDefinitions } from './formatters';

// Event tools helpers
export { getUpcomingEventsContext, setEventToolsUserId, clearEventToolsUserId } from './events';

// Aggregate all tools
import { googleMapsTools } from './google-maps';
import { internetSearchTools } from './internet-search';
import { internetSearchPremiumTools } from './internet-search-premium';
import { newsSearchTools } from './news-search';
import { imageSearchTools } from './image-search';
import { readUrlTools } from './read-url';
import { eventTools } from './events';
import { shellCommandTools } from './shell-command';
import { shellImageUploadTools } from './shell-image-upload';
import { discoverAppsTools } from './discover-apps';
import { appInfoTools } from './app-info';
import { runAppTools } from './run-app';
import { toolCallRetrievalTools } from './tool-call-retrieval';
import { killToolCallJobTools } from './kill-tool-call-job';
import { codingTools, CODING_TOOL_NAMES } from './coding-tools';
import { searchFactsTools } from './search-facts';
import { searchConversationsTools } from './search-conversations';
import { searchConversationTools } from './search-conversation';
import { Tool } from './types';
import { getToolContext, runWithToolContext } from './context';
import { addToolCallLog, markToolCallLogYielded, updateToolCallLogResult, addChatEvent } from '../../db';
import { getParentJobContext } from './job-context';
import { isKillToolCallJobEnabled } from '../../yield-orchestration';

// Keep this long enough to absorb repeated duplicate calls in one model turn.
const DEFAULT_TOOL_DEDUPE_WINDOW_MS = 10000;

type ToolDedupeEntry = {
  promise: Promise<any>;
  inFlight: boolean;
  expiresAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const toolExecutionDedupe = new Map<string, ToolDedupeEntry>();

function getToolDedupeWindowMs(): number {
  const raw = process.env.TOOL_CALL_DEDUPE_WINDOW_MS;
  if (!raw) return DEFAULT_TOOL_DEDUPE_WINDOW_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TOOL_DEDUPE_WINDOW_MS;
  return Math.floor(parsed);
}

function stableStringify(value: any): string {
  const seen = new WeakSet<object>();

  const normalize = (input: any): any => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map(item => normalize(item));
    }

    const obj: Record<string, any> = {};
    const keys = Object.keys(input).sort();
    for (const key of keys) {
      obj[key] = normalize(input[key]);
    }
    return obj;
  };

  return JSON.stringify(normalize(value));
}

function buildToolDedupeKey(name: string, args: any, context: ToolExecutionContext): string | undefined {
  const scope = context.parentJobId ?? context.conversationId;
  if (!scope) return undefined;
  return `${scope}::${name}::${stableStringify(args ?? {})}`;
}

async function runWithToolDedupe<T>(
  dedupeKey: string,
  dedupeWindowMs: number,
  execute: () => Promise<T>
): Promise<T> {
  const existing = toolExecutionDedupe.get(dedupeKey);
  const now = Date.now();
  if (existing && (existing.inFlight || existing.expiresAt > now)) {
    console.log(`[TOOL_DEDUPE_HIT] ${dedupeKey}`);
    return existing.promise;
  }

  if (existing?.cleanupTimer) {
    clearTimeout(existing.cleanupTimer);
  }
  toolExecutionDedupe.delete(dedupeKey);

  const entry: ToolDedupeEntry = {
    promise: Promise.resolve(null),
    inFlight: true,
    expiresAt: Number.POSITIVE_INFINITY,
  };

  entry.promise = execute()
    .finally(() => {
      entry.inFlight = false;
      entry.expiresAt = Date.now() + dedupeWindowMs;
      entry.cleanupTimer = setTimeout(() => {
        const latest = toolExecutionDedupe.get(dedupeKey);
        if (latest === entry) {
          toolExecutionDedupe.delete(dedupeKey);
        }
      }, dedupeWindowMs);

      if (typeof entry.cleanupTimer.unref === 'function') {
        entry.cleanupTimer.unref();
      }
    });

  toolExecutionDedupe.set(dedupeKey, entry);
  return entry.promise;
}

const isTest = process.env.NODE_ENV === 'test';
const hasBraveKey = !!process.env.BRAVE_API_KEY;
const hasTavilyKey = !!process.env.TAVILY_API_KEY;
const enableKillToolCallJob = isKillToolCallJobEnabled();

export const allTools: Tool[] = [
  ...googleMapsTools,
  ...(!isTest && hasBraveKey ? internetSearchTools : []),
  ...(!isTest && hasTavilyKey ? internetSearchPremiumTools : []),
  ...(!isTest && hasTavilyKey ? readUrlTools : []),
  ...(!isTest && hasBraveKey ? newsSearchTools : []),
  ...(!isTest && hasBraveKey ? imageSearchTools : []),
  ...eventTools,
  ...shellCommandTools,
  ...shellImageUploadTools,
  ...discoverAppsTools,
  ...appInfoTools,
  ...runAppTools,
  ...toolCallRetrievalTools,
  ...(enableKillToolCallJob ? killToolCallJobTools : []),
  ...codingTools,
  ...searchFactsTools,
  ...searchConversationsTools,
  ...searchConversationTools,
];

export { CODING_TOOL_NAMES } from './coding-tools';

export interface ToolExecutionContext {
  conversationId?: string;
  messageId?: string;
  parentJobId?: string;
  skipLogging?: boolean;
}

/**
 * Execute any registered tool by name.
 * This is the only function AI providers need to call.
 */
export async function executeTool(name: string, args: any, context?: ToolExecutionContext): Promise<any> {
  const tool = allTools.find(t => t.definition.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const toolContext = getToolContext();
  const executionContext: ToolExecutionContext = {
    conversationId: context?.conversationId ?? toolContext?.conversationId,
    messageId: context?.messageId ?? toolContext?.messageId,
    parentJobId: context?.parentJobId ?? toolContext?.parentJobId,
    skipLogging: context?.skipLogging,
  };

  const isRetrievalTool = name === 'retrieve_tool_responses';
  const shouldLog = !executionContext.skipLogging && !isRetrievalTool && !!executionContext.conversationId;
  let toolCallLogId: string | undefined;
  const dedupeWindowMs = getToolDedupeWindowMs();
  const dedupeKey = buildToolDedupeKey(name, args, executionContext);
  let toolCallId: string | undefined;

  if (shouldLog && executionContext.conversationId) {
    const log = await addToolCallLog(
      executionContext.conversationId,
      name,
      args,
      {
        parentJobId: executionContext.parentJobId,
        messageId: executionContext.messageId,
        isRetrievalTool: false,
      }
    );
    toolCallLogId = log.id;
    toolCallId = log.tool_call_id;

    // Flush text/thought event buffers before writing tool_call event (ensures correct seq ordering)
    const parentCtx = getParentJobContext();
    if (parentCtx?.flushEventBuffers) {
      await parentCtx.flushEventBuffers();
    }

    // Write tool_call chat event
    const callExtra = tool.getCallEventExtra?.(args) ?? {};
    const toolCallEvt = await addChatEvent(executionContext.conversationId, 'tool_call', {
      tool_name: name,
      arguments: args,
      call_id: log.tool_call_id,
      ...callExtra,
    });
    if (parentCtx?.emitEventPersisted) {
      await parentCtx.emitEventPersisted(toolCallEvt);
    }
  }

  try {
    const runTool = () => {
      console.log(`[TOOL_CALL] ${name}`, JSON.stringify(args));
      const scopedToolContext = {
        ...(toolContext || {}),
        conversationId: executionContext.conversationId,
        parentJobId: executionContext.parentJobId,
        toolCallLogId,
        toolCallId,
      };
      return runWithToolContext(scopedToolContext, () => tool.execute(args));
    };
    const result = dedupeKey
      ? await runWithToolDedupe(dedupeKey, dedupeWindowMs, runTool)
      : await runTool();

    if (toolCallLogId) {
      const yielded = result && typeof result === 'object' && result.status === 'yielded' && typeof result.job_id === 'string';
      if (yielded) {
        await markToolCallLogYielded(toolCallLogId, {
          asyncJobId: result.job_id,
          response: result,
        });
        // Write tool_result chat event for yield
        if (executionContext.conversationId && toolCallId) {
          const yieldExtra = tool.getResultEventExtra?.(result) ?? {};
          const trEvt = await addChatEvent(executionContext.conversationId, 'tool_result', {
            call_id: toolCallId,
            status: 'yield',
            async_job_id: result.job_id,
            ...yieldExtra,
          });
          const parentCtx = getParentJobContext();
          if (parentCtx?.emitEventPersisted) {
            await parentCtx.emitEventPersisted(trEvt);
          }
        }
      } else {
        await updateToolCallLogResult(toolCallLogId, {
          status: 'succeeded',
          response: result,
        });
        // Write tool_result chat event for success
        if (executionContext.conversationId && toolCallId) {
          const resultExtra = tool.getResultEventExtra?.(result) ?? {};
          const trEvt = await addChatEvent(executionContext.conversationId, 'tool_result', {
            call_id: toolCallId,
            status: 'success',
            ...resultExtra,
          });
          const parentCtx = getParentJobContext();
          if (parentCtx?.emitEventPersisted) {
            await parentCtx.emitEventPersisted(trEvt);
          }
        }
      }
    }
    return result;
  } catch (error) {
    console.error(`[TOOL_ERROR] ${name}`, error);
    if (toolCallLogId) {
      await updateToolCallLogResult(toolCallLogId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      // Write tool_result chat event for error
      if (executionContext.conversationId && toolCallId) {
        const errorExtra = tool.getResultEventExtra?.(undefined, error instanceof Error ? error : new Error(String(error))) ?? {};
        const trEvt = await addChatEvent(executionContext.conversationId, 'tool_result', {
          call_id: toolCallId,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          ...errorExtra,
        });
        const parentCtx = getParentJobContext();
        if (parentCtx?.emitEventPersisted) {
          await parentCtx.emitEventPersisted(trEvt);
        }
      }
    }
    throw error;
  }
}

/**
 * Get a human-readable status message for a tool
 */
export function getToolStatusMessage(name: string): string {
  switch (name) {
    case 'search_places':
      return 'Searching Places...';
    case 'compute_routes':
      return 'Calculating Route...';
    case 'internet_search':
      return 'Searching the Web...';
    case 'internet_search_premium':
      return 'Searching the Web (Premium)...';
    case 'read_url':
      return 'Reading Content...';
    case 'news_search':
      return 'Searching News...';
    case 'image_search':
      return 'Searching Images...';
    case 'get_weather_by_location':
    case 'get_weather_by_coordinates':
      return 'Checking Weather...';
    case 'get_air_quality_by_location':
    case 'get_air_quality_by_coordinates':
      return 'Checking Air Quality...';
    case 'search_events':
      return 'Searching Events...';
    case 'get_events_by_date_range':
    case 'get_upcoming_events':
    case 'get_past_events':
    case 'get_all_events':
    case 'get_event':
      return 'Getting Events...';
    case 'create_event':
      return 'Creating Event...';
    case 'update_event':
      return 'Updating Event...';
    case 'delete_event':
      return 'Deleting Event...';
    case 'run_shell_command':
      return 'Running Command...';
    case 'shell_image_upload':
      return 'Uploading images...';
    case 'discover_apps':
      return 'Discovering Apps...';
    case 'app_info':
      return 'Getting App Info...';
    case 'run_app':
      return 'Running App Command...';
    case 'retrieve_tool_responses':
      return 'Retrieving tool responses...';
    case 'kill_tool_call_job':
      return 'Stopping tool job...';
    case 'read_file':
      return 'Reading File...';
    case 'write_file':
      return 'Writing File...';
    case 'patch_file':
      return 'Editing File...';
    case 'list_files':
      return 'Listing Files...';
    case 'search_files':
      return 'Searching Files...';
    case 'search_facts':
      return 'Searching Facts...';
    case 'search_conversations':
      return 'Searching Conversations...';
    case 'search_conversation':
      return 'Searching in Conversation...';
    default:
      return 'Using Tool...';
  }
}
