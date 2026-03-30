import { ToolDefinition, Tool } from './types';
import { requireUserId } from './context';
import { searchConversations, getLatestFactSheet, searchRecentConversationsByMessages } from '../../db';

function formatTimestamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

const searchConversationsDefinition: ToolDefinition = {
  name: "search_conversations",
  description: "Search past conversations by title or linked facts. Returns a list of matching conversations with their IDs. Use the search_conversation tool with a conversation ID to look inside a specific conversation.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "Search query to match against conversation titles and linked facts"
      },
      limit: {
        type: "INTEGER",
        description: "Max results (default 5, max 10)"
      }
    },
    required: ["query"]
  }
};

async function executeSearchConversations(args: any): Promise<string> {
  const userId = requireUserId();
  const query = args.query as string;
  const limit = Math.min(Math.max(args.limit || 5, 1), 10);

  const results = await searchConversations(userId, query);
  const seenIds = new Set(results.map(c => c.id));

  // Search recent conversations by message content (gap coverage)
  const factSheet = await getLatestFactSheet(userId);
  if (factSheet) {
    const recentConvs = await searchRecentConversationsByMessages(userId, query, factSheet.created_at);
    for (const conv of recentConvs) {
      if (!seenIds.has(conv.id)) {
        results.push(conv);
        seenIds.add(conv.id);
      }
    }
  }

  const sliced = results.slice(0, limit);

  if (sliced.length === 0) {
    return `No conversations found matching '${query}'.`;
  }

  const lines = sliced.map(c => {
    const time = c.updated_at ? formatTimestamp(c.updated_at) : 'unknown';
    return `- ${c.title} (id: ${c.id}, updated: ${time})`;
  });

  return `Found ${sliced.length} conversation${sliced.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}

export const searchConversationsTools: Tool[] = [
  {
    definition: searchConversationsDefinition,
    execute: executeSearchConversations,
    getCallEventExtra(args) {
      return { queries: [args.query] };
    },
    getResultEventExtra(result) {
      if (typeof result !== 'string') return undefined;
      const countMatch = result.match(/Found (\d+) conversation/);
      const count = countMatch ? parseInt(countMatch[1], 10) : 0;
      // Extract conversation lines (each starts with "- ")
      const items = result.split('\n')
        .filter(l => l.startsWith('- '))
        .map(l => {
          const titleMatch = l.match(/^- (.+?) \(id:/);
          return titleMatch ? titleMatch[1] : l.slice(2);
        });
      return { result_count: count, items };
    },
  }
];
