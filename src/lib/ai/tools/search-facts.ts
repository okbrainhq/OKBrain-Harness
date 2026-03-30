import { ToolDefinition, Tool } from './types';
import { requireUserId } from './context';
import { searchFactsByKeyword, getLatestFactSheet, searchRecentMessages } from '../../db';

function formatTimestamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

const searchFactsDefinition: ToolDefinition = {
  name: "search_facts",
  description: "Search the user's stored facts/knowledge by keyword. Use this when the user asks what you know about a topic, or when you need to recall specific details. Facts are brief atomic summaries (max 15 words each). For detailed information like product comparisons, prices, step-by-step decisions, or full discussions, also use search_conversations and search_conversation to find the original conversation.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "Keyword(s) to search for in facts"
      },
      category: {
        type: "STRING",
        description: "Optional category filter",
        enum: ["core", "technical", "project", "transient"]
      },
      limit: {
        type: "INTEGER",
        description: "Max results to return (default 10, max 30)"
      }
    },
    required: ["query"]
  }
};

async function executeSearchFacts(args: any): Promise<string> {
  const userId = requireUserId();
  const query = args.query as string;
  const category = args.category as string | undefined;
  const limit = Math.min(Math.max(args.limit || 10, 1), 30);

  const results = await searchFactsByKeyword(userId, query, category, limit);

  const parts: string[] = [];

  if (results.length > 0) {
    const lines = results.map(r => {
      const time = formatTimestamp(r.created_at);
      return `- ${r.fact} (${r.category}, ${time})`;
    });
    parts.push(`Found ${results.length} fact${results.length === 1 ? '' : 's'}:\n${lines.join('\n')}`);
  }

  // Search recent messages not yet covered by fact extraction
  const factSheet = await getLatestFactSheet(userId);
  if (factSheet) {
    const recentMessages = await searchRecentMessages(
      userId, query, factSheet.created_at, ['user_message'], 5
    );
    if (recentMessages.length > 0) {
      const lines = recentMessages.map(m => {
        const time = formatTimestamp(m.created_at);
        return `- "${m.text}" (from: ${m.conversation_title}, ${time})`;
      });
      parts.push(`\nRecent mentions (not yet extracted):\n${lines.join('\n')}`);
    }
  }

  if (parts.length === 0) {
    return `No facts found matching '${query}'.`;
  }

  return parts.join('\n');
}

export const searchFactsTools: Tool[] = [
  {
    definition: searchFactsDefinition,
    execute: executeSearchFacts,
    getCallEventExtra(args) {
      return { queries: [args.query] };
    },
    getResultEventExtra(result) {
      if (typeof result !== 'string') return undefined;
      const countMatch = result.match(/Found (\d+) fact/);
      const count = countMatch ? parseInt(countMatch[1], 10) : 0;
      // Extract fact lines (each starts with "- ")
      const items = result.split('\n')
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2));
      return { result_count: count, items };
    },
  }
];
