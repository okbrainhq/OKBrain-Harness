/**
 * AI Context Injection
 *
 * Common utility for injecting context (memory, events, documents, timezone)
 * as message pairs into AI conversations.
 */

import { AIMessage } from './types';
import type { ChatEvent } from '../db/db-types';
import {
  buildEventsContextPrompt,
  buildContextAcknowledgement,
  buildTimezoneInstructions,
  buildUserMemoryPrompt,
  buildFactsContextPrompt,
  buildRagFactsContextPrompt,
  buildRecentConversationsPrompt,
  buildDocumentContextPrompt,
} from './system-prompts';

export interface AIContext {
  modelName: string;
  userMemory?: { memory_text: string } | null;
  facts?: Array<{ category: string; fact: string }> | null;
  ragFacts?: Array<{ fact: string; category: string; distance: number; last_extracted_at: string | null }> | null;
  recentConversations?: Array<{ title: string; userMessages: string[] }> | null;
  eventsContext?: string | null;
  documents?: Array<{ title: string; content: string }>;
  includeTimezone?: boolean;
}

export interface InterleavedAIMessage extends AIMessage {
  id: string;
}

export interface ToolCallLogContextEntry {
  message_id: string | null;
  tool_call_id: string;
  tool_name: string;
  status: 'requested' | 'yielded' | 'succeeded' | 'failed';
  arguments: string;
  response: string | null;
  error: string | null;
}

function shorten(value: string, max: number = 1200): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated]`;
}

function safeJsonString(input: string | null): string {
  if (!input) return 'null';
  try {
    return shorten(JSON.stringify(JSON.parse(input)));
  } catch {
    return shorten(input);
  }
}

function buildToolCallLogMessagePair(
  modelName: string,
  log: ToolCallLogContextEntry
): AIMessage[] {
  const request = `[Tool Call ${log.tool_call_id}] ${log.tool_name}(arguments=${safeJsonString(log.arguments)})`;

  const responseParts = [
    `[Tool Result ${log.tool_call_id}] status=${log.status}`,
    'full_response=omitted_to_save_context',
    `to_inspect_response=call_retrieve_tool_responses_with_tool_call_ids_["${log.tool_call_id}"]`,
  ];

  if (log.error) {
    responseParts.push(`error=${shorten(log.error, 500)}`);
  }

  return [
    { role: 'user', content: request },
    { role: 'assistant', content: responseParts.join(' | '), model: modelName },
  ];
}

export function interleaveToolCallLogs(
  messages: InterleavedAIMessage[],
  toolCallLogs: ToolCallLogContextEntry[],
  modelName: string
): AIMessage[] {
  if (toolCallLogs.length === 0) {
    return messages.map(({ id: _id, ...message }) => message);
  }

  const logsByMessageId = new Map<string, ToolCallLogContextEntry[]>();
  const unlinkedLogs: ToolCallLogContextEntry[] = [];

  for (const log of toolCallLogs) {
    if (!log.message_id) {
      unlinkedLogs.push(log);
      continue;
    }

    const existing = logsByMessageId.get(log.message_id) || [];
    existing.push(log);
    logsByMessageId.set(log.message_id, existing);
  }

  const result: AIMessage[] = [];

  for (const message of messages) {
    const logs = logsByMessageId.get(message.id) || [];
    for (const log of logs) {
      result.push(...buildToolCallLogMessagePair(modelName, log));
    }
    const { id: _id, ...cleanMessage } = message;
    result.push(cleanMessage);
  }

  for (const log of unlinkedLogs) {
    result.push(...buildToolCallLogMessagePair(modelName, log));
  }

  return result;
}

/**
 * Injects context (memory, events, documents, timezone) as message pairs
 * at the beginning of the conversation. Each context is added as a
 * user message followed by an assistant acknowledgment.
 *
 * Order (from earliest to latest in conversation):
 * 1. Events context (if available)
 * 2. Timezone instructions (if enabled)
 * 3. User memory (if available)
 * 4. Documents (if available)
 * 5. Original messages
 */
export function injectContextMessages(
  messages: AIMessage[],
  context: AIContext
): AIMessage[] {
  const result = [...messages];
  const { modelName, userMemory, eventsContext, documents, includeTimezone } = context;

  // Inject document context if available (will be first after all injections)
  if (documents && documents.length > 0) {
    result.unshift({
      role: 'user',
      content: buildDocumentContextPrompt(documents),
    });
    result.splice(1, 0, {
      role: 'assistant',
      content: buildContextAcknowledgement('documents'),
      model: modelName,
    });
  }

  // Inject User Memory if available
  if (userMemory?.memory_text) {
    result.unshift({
      role: 'user',
      content: buildUserMemoryPrompt(userMemory.memory_text),
    });
    result.splice(1, 0, {
      role: 'assistant',
      content: buildContextAcknowledgement('memory'),
      model: modelName,
    });
  }

  // Inject Recent Conversations if available (before facts for lower priority)
  if (context.recentConversations && context.recentConversations.length > 0) {
    result.unshift({
      role: 'user',
      content: buildRecentConversationsPrompt(context.recentConversations),
    });
    result.splice(1, 0, {
      role: 'assistant',
      content: buildContextAcknowledgement('recentConversations'),
      model: modelName,
    });
  }

  // Inject User Facts if available (fact sheet — higher priority than RAG facts)
  if (context.facts && context.facts.length > 0) {
    result.unshift({
      role: 'user',
      content: buildFactsContextPrompt(context.facts),
    });
    result.splice(1, 0, {
      role: 'assistant',
      content: buildContextAcknowledgement('facts'),
      model: modelName,
    });
  }

  // Inject timezone handling instructions
  if (includeTimezone) {
    result.unshift({
      role: 'user',
      content: buildTimezoneInstructions(),
    });
    result.splice(1, 0, {
      role: 'assistant',
      content: buildContextAcknowledgement('timezone'),
      model: modelName,
    });
  }

  // Inject Upcoming Events if available
  if (eventsContext && !eventsContext.includes('No upcoming events')) {
    result.unshift({
      role: 'user',
      content: buildEventsContextPrompt(eventsContext),
    });
    result.splice(1, 0, {
      role: 'assistant',
      content: buildContextAcknowledgement('events'),
      model: modelName,
    });
  }

  // Inject RAG Facts right before the current user message (last position).
  // This keeps the stable context + conversation history in the cacheable prefix.
  if (context.ragFacts && context.ragFacts.length > 0) {
    const insertPos = result.length - 1;
    result.splice(insertPos, 0,
      {
        role: 'user' as const,
        content: buildRagFactsContextPrompt(context.ragFacts),
      },
      {
        role: 'assistant' as const,
        content: buildContextAcknowledgement('ragFacts'),
        model: modelName,
      }
    );
  }

  return result;
}

export interface BuildMessagesFromEventsOptions {
  modelName: string;
  includeThoughtsInHistory?: boolean;
  imageData?: { mimeType: string; base64: string };
  fileData?: Array<{ fileUri: string; mimeType: string }>;
}

/**
 * Builds AI message array from chat events, replacing the old
 * getConversationMessages + interleaveToolCallLogs approach.
 * Events are already in chronological order by seq.
 */
export function buildMessagesFromEvents(
  events: ChatEvent[],
  options: BuildMessagesFromEventsOptions
): AIMessage[] {
  const { modelName, includeThoughtsInHistory, imageData, fileData } = options;
  const messages: AIMessage[] = [];

  // Find the last user_message event index for attaching image/files
  let lastUserMessageIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'user_message') {
      lastUserMessageIdx = i;
      break;
    }
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    let content: any;
    try {
      content = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch {
      content = event.content;
    }

    switch (event.kind) {
      case 'user_message': {
        const msg: AIMessage = { role: 'user', content: content.text || '' };
        // Attach image/files to the last user message
        if (i === lastUserMessageIdx) {
          if (imageData) {
            (msg as any).image = imageData;
          }
          if (fileData) {
            (msg as any).files = fileData;
          }
        }
        messages.push(msg);
        break;
      }

      case 'thought': {
        if (includeThoughtsInHistory && content.text) {
          messages.push({
            role: 'assistant',
            content: `<thinking>${content.text}</thinking>`,
            model: modelName,
          });
        }
        break;
      }

      case 'assistant_text': {
        if (content.text) {
          messages.push({
            role: 'assistant',
            content: content.text,
            model: content.model || modelName,
          });
        }
        break;
      }

      case 'tool_call': {
        const argsStr = typeof content.arguments === 'string'
          ? safeJsonString(content.arguments)
          : shorten(JSON.stringify(content.arguments));
        messages.push({
          role: 'user',
          content: `[Tool Call ${content.call_id}] ${content.tool_name}(arguments=${argsStr})`,
        });
        break;
      }

      case 'tool_result': {
        const responseParts = [
          `[Tool Result ${content.call_id}] status=${content.status}`,
          'full_response=omitted_to_save_context',
          `to_inspect_response=call_retrieve_tool_responses_with_tool_call_ids_["${content.call_id}"]`,
        ];
        if (content.error) {
          responseParts.push(`error=${shorten(content.error, 500)}`);
        }
        messages.push({
          role: 'assistant',
          content: responseParts.join(' | '),
          model: modelName,
        });
        break;
      }

      case 'summary': {
        if (content.text) {
          messages.push({
            role: 'assistant',
            content: content.text,
            model: content.model || modelName,
          });
        }
        break;
      }

      case 'compaction': {
        // Compaction replaces all prior history with the summary
        messages.length = 0;
        messages.push({
          role: 'user',
          content: `[Previous conversation context]\n${content.text}`,
        });
        messages.push({
          role: 'assistant',
          content: 'Understood. Continuing from the compacted context.',
          model: content.model || modelName,
        });
        break;
      }

      case 'stopped': {
        messages.push({
          role: 'assistant',
          content: '[User stopped the response]',
          model: content.model || modelName,
        });
        break;
      }

      // Skip status, sources - not needed for AI context
      default:
        break;
    }
  }

  return messages;
}
