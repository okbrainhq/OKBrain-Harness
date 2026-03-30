import { ToolDefinition, Tool } from './types';
import { withCitationReminder } from './search-citation-reminder';

function getBraveApiKey(): string {
  const apiKey = process.env.BRAVE_API_KEY || '';
  if (!apiKey) {
    console.warn('No Brave API key found. Set BRAVE_API_KEY in your .env.local file.');
  }
  return apiKey;
}

const newsSearchDefinition: ToolDefinition = {
  name: "news_search",
  description: "Search news articles to find out what happened recently. Use this when the user asks about recent events, breaking news, or what happened today/yesterday/this week on a topic. Use the freshness field to match the time period. For general knowledge or fact-finding queries, prefer internet_search instead. You can provide multiple searches to cover different aspects of the topic.\n\nEach result contains:\n- title: Article headline\n- url: Article URL\n- description: Summary of the article\n- extra_snippets: (optional) Additional excerpts from the article\n- posted_at: How old the article is (e.g. '2 hours ago', '1 day ago')\n- source: Publisher hostname\n\nIMPORTANT: Always check the posted_at field before answering time-sensitive questions. It helps determine how recent or relevant a result is.",
  parameters: {
    type: "OBJECT",
    properties: {
      searches: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "The news search query. Max 400 characters and 50 words."
            },
            freshness: {
              type: "STRING",
              description: "Filter results by discovery time. Options: 'pd' (past 24 hours), 'pw' (past 7 days), 'pm' (past 31 days), 'py' (past 365 days).",
              enum: ["pd", "pw", "pm", "py"]
            }
          },
          required: ["query"]
        },
        description: "An array of news searches to execute in parallel. Each search has its own query and optional freshness filter."
      }
    },
    required: ["searches"]
  }
};

async function searchNews(apiKey: string, query: string, freshness?: string): Promise<any> {
  const params = new URLSearchParams({ q: query });

  if (freshness) {
    params.set('freshness', freshness);
  }

  params.set('country', 'ALL');

  const response = await fetch(
    `https://api.search.brave.com/res/v1/news/search?${params.toString()}`,
    {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return { query, error: `Brave News Search API error (${response.status}): ${errorText}` };
  }

  const data = await response.json();

  const results = (data.results || []).map((article: any) => {
    const result: any = {
      title: article.title,
      url: article.url,
      description: article.description,
      posted_at: article.age,
      source: article.meta_url?.hostname || '',
    };

    if (article.extra_snippets?.length) {
      result.extra_snippets = article.extra_snippets.slice(0, 2);
    }

    return result;
  });

  return { query, results };
}

async function executeNewsSearch(args: any): Promise<any> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    return { error: "Brave API key is missing. Please set BRAVE_API_KEY in .env.local" };
  }

  const searches = args.searches || [];
  if (searches.length === 0) {
    return { error: "No searches provided for news search." };
  }

  try {
    const searchPromises = searches.map((search: any) =>
      searchNews(apiKey, search.query, search.freshness).catch((err: any) => ({
        query: search.query,
        error: err.message
      }))
    );

    const results = await Promise.all(searchPromises);
    return withCitationReminder({ results });
  } catch (error: any) {
    return { error: `Unexpected error during news search: ${error.message}` };
  }
}

export const newsSearchTools: Tool[] = [
  {
    definition: newsSearchDefinition,
    execute: executeNewsSearch,

    getCallEventExtra(args) {
      const queries = (args.searches || []).map((s: any) => s.query);
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

export const newsSearchToolDefinitions: ToolDefinition[] = newsSearchTools.map(t => t.definition);

export async function executeNewsSearchTool(name: string, args: any): Promise<any> {
  const tool = newsSearchTools.find(t => t.definition.name === name);
  if (!tool) {
    throw new Error(`Unknown News Search tool: ${name}`);
  }
  return tool.execute(args);
}
