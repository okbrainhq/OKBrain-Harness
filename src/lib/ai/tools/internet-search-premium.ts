import { ToolDefinition, Tool } from './types';
import { withCitationReminder } from './search-citation-reminder';

function getTavilyApiKey(): string {
  const apiKey = process.env.TAVILY_API_KEY || '';
  if (!apiKey) {
    console.warn('No Tavily API key found. Set TAVILY_API_KEY in your .env file.');
  }
  return apiKey;
}

const internetSearchDefinition: ToolDefinition = {
  name: "internet_search_premium",
  description: "A premium internet search with advanced depth. Use this ONLY as a fallback when internet_search didn't return good enough results. For recent news, prefer news_search instead.",
  parameters: {
    type: "OBJECT",
    properties: {
      queries: {
        type: "ARRAY",
        items: {
          type: "STRING"
        },
        description: "An array of search queries to execute. Provide multiple queries to cover different aspects of the topic."
      }
    },
    required: ["queries"]
  }
};

async function tavilySearch(apiKey: string, query: string): Promise<any> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: 'advanced' }),
  });
  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function executeInternetSearch(args: any): Promise<any> {
  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    return { error: "Tavily API key is missing. Please set TAVILY_API_KEY in .env.local" };
  }

  const queries = args.queries || [];

  if (queries.length === 0) {
    return { error: "No queries provided for search." };
  }

  try {
    const searchPromises = queries.map((query: string) =>
      tavilySearch(apiKey, query).catch((err: any) => ({
        query,
        error: err.message
      }))
    );

    const results = await Promise.all(searchPromises);

    return withCitationReminder({
      results: results
    });
  } catch (error: any) {
    return { error: `Unexpected error during internet search: ${error.message}` };
  }
}

export const internetSearchPremiumTools: Tool[] = [
  {
    definition: internetSearchDefinition,
    execute: executeInternetSearch,

    getCallEventExtra(args) {
      const queries = args.queries || [];
      return { queries };
    },

    getResultEventExtra(result) {
      if (!result?.results) return undefined;
      const items = result.results.flatMap((r: any) =>
        (r.results || []).slice(0, 5).map((item: any) => ({
          title: item.title,
          url: item.url,
        }))
      );
      return { items };
    },
  }
];
