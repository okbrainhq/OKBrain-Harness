import { ToolDefinition, Tool } from './types';
import { requireUserId } from './context';
import { getConversation, getConversationTextEvents } from '../../db';

const searchConversationDefinition: ToolDefinition = {
  name: "search_conversation",
  description: "Search within a specific conversation's messages. Returns matching snippets with surrounding context messages. Use search_conversations first to find the conversation ID, then use this tool to look inside it.",
  parameters: {
    type: "OBJECT",
    properties: {
      conversation_id: {
        type: "STRING",
        description: "The conversation ID to search within"
      },
      query: {
        type: "STRING",
        description: "Text to search for within messages"
      },
      context_before: {
        type: "INTEGER",
        description: "Number of messages to include before each match (default 1)"
      },
      context_after: {
        type: "INTEGER",
        description: "Number of messages to include after each match (default 1)"
      },
      max_matches: {
        type: "INTEGER",
        description: "Maximum number of matches to return (default 3, max 10)"
      }
    },
    required: ["conversation_id", "query"]
  }
};

function formatTimestamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

interface TextEvent {
  seq: number;
  kind: string;
  text: string;
  created_at: string;
}

async function executeSearchConversation(args: any): Promise<string> {
  const userId = requireUserId();
  const conversationId = args.conversation_id as string;
  const query = args.query as string;
  const contextBefore = Math.max(args.context_before ?? 1, 0);
  const contextAfter = Math.max(args.context_after ?? 1, 0);
  const maxMatches = Math.min(Math.max(args.max_matches || 3, 1), 10);

  // Verify ownership
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) {
    return `Conversation not found or you don't have access to it.`;
  }

  // Fetch all text events
  const rawEvents = await getConversationTextEvents(conversationId);
  const events: TextEvent[] = rawEvents.map(e => {
    let text = '';
    try {
      const parsed = JSON.parse(e.content);
      text = parsed.text || '';
    } catch {
      text = e.content;
    }
    return { seq: e.seq, kind: e.kind, text, created_at: e.created_at };
  });

  if (events.length === 0) {
    return `No messages found in conversation "${conversation.title}".`;
  }

  // Find matches (case-insensitive): whole-word > exact phrase substring > word substring
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/).filter(w => w.length > 0);
  const wordBoundaryRegexes = words.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  const exactBoundaryRegex = new RegExp(`\\b${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

  // Priority buckets: whole-word exact > whole-word any > substring exact > substring any
  const wholeWordExact: number[] = [];
  const wholeWordAny: number[] = [];
  const substringExact: number[] = [];
  const substringAny: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const text = events[i].text;
    const textLower = text.toLowerCase();
    if (exactBoundaryRegex.test(text)) {
      wholeWordExact.push(i);
    } else if (wordBoundaryRegexes.some(r => r.test(text))) {
      wholeWordAny.push(i);
    } else if (textLower.includes(queryLower)) {
      substringExact.push(i);
    } else if (words.some(w => textLower.includes(w))) {
      substringAny.push(i);
    }
  }

  const allMatchIndices = [...wholeWordExact, ...wholeWordAny, ...substringExact, ...substringAny];
  if (allMatchIndices.length === 0) {
    return `No matches found for '${query}' in conversation "${conversation.title}".`;
  }

  // Take exact matches first, then word matches, up to maxMatches — then sort by position
  const selected = allMatchIndices.slice(0, maxMatches).sort((a, b) => a - b);

  // Build context windows, merge overlapping
  const windows: { start: number; end: number; matchIndices: number[] }[] = [];
  for (const idx of selected) {
    const start = Math.max(0, idx - contextBefore);
    const end = Math.min(events.length - 1, idx + contextAfter);

    // Try to merge with previous window if overlapping
    const prev = windows[windows.length - 1];
    if (prev && start <= prev.end + 1) {
      prev.end = end;
      prev.matchIndices.push(idx);
    } else {
      windows.push({ start, end, matchIndices: [idx] });
    }
  }

  // Format output
  const parts: string[] = [];
  let matchNum = 0;

  for (const window of windows) {
    for (let i = window.start; i <= window.end; i++) {
      const event = events[i];
      const role = event.kind === 'user_message' ? 'user' : 'assistant';
      const time = formatTimestamp(event.created_at);
      const isMatch = window.matchIndices.includes(i);
      if (isMatch) matchNum++;
      const marker = isMatch ? ' ← match' : '';
      parts.push(`[${role}, ${time}] ${event.text}${marker}`);
    }
    parts.push('');
  }

  const shownCount = selected.length;
  const totalCount = allMatchIndices.length;
  const header = `Conversation: ${conversation.title} (${totalCount} match${totalCount === 1 ? '' : 'es'}${totalCount > shownCount ? `, showing first ${shownCount}` : ''})`;

  return `${header}\n\n${parts.join('\n').trim()}`;
}

export const searchConversationTools: Tool[] = [
  {
    definition: searchConversationDefinition,
    execute: executeSearchConversation,
    getCallEventExtra(args) {
      return { queries: [args.query] };
    },
    getResultEventExtra(result) {
      if (typeof result !== 'string') return undefined;
      const countMatch = result.match(/\((\d+) match/);
      const count = countMatch ? parseInt(countMatch[1], 10) : 0;
      const titleMatch = result.match(/^Conversation: (.+?) \(/);
      const title = titleMatch ? titleMatch[1] : undefined;
      return { result_count: count, conversation_title: title };
    },
  }
];
