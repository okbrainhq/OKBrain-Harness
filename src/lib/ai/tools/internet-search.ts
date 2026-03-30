import { ToolDefinition, Tool } from './types';
import { withCitationReminder } from './search-citation-reminder';

function getBraveApiKey(): string {
  const apiKey = process.env.BRAVE_API_KEY || '';
  if (!apiKey) {
    console.warn('No Brave API key found. Set BRAVE_API_KEY in your .env.local file.');
  }
  return apiKey;
}

const internetSearchDefinition: ToolDefinition = {
  name: "internet_search",
  shortDescription: "Search the internet. Provide an array of search query strings.",
  description: "Search the internet for general information, specific facts, or any topic where your internal knowledge might be outdated. Returns 5 results per query. For recent news, breaking events, or what happened today/yesterday/this week, prefer news_search instead. Use read_url to get the full content of a specific URL from the results. You can provide multiple searches to cover different aspects of the topic.\n\nEach result contains:\n- title: Page title\n- url: Page URL\n- description: Snippet/summary of the page\n- extra_snippets: (only when extra_info is true) Additional excerpts from the page\n- posted_at: (optional) How old the page is (e.g. '6 hours ago', '2 days ago')\n\nIMPORTANT: Always check the posted_at field before answering time-sensitive questions. It helps determine how recent or relevant a result is.",
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
              description: "The web search query. Max 400 characters and 50 words."
            },
            count: {
              type: "INTEGER",
              description: "Number of results to return. Defaults to 5. Max 20."
            },
            extra_info: {
              type: "BOOLEAN",
              description: "Set to true to include extra snippets from each result for more detailed information. Defaults to false."
            }
          },
          required: ["query"]
        },
        description: "An array of web searches to execute in parallel."
      }
    },
    required: ["searches"]
  }
};

async function searchWeb(apiKey: string, query: string, count: number = 5, extraInfo: boolean = false): Promise<any> {
  const params = new URLSearchParams({ q: query });

  params.set('country', 'ALL');
  params.set('count', String(Math.min(count, 20)));
  params.set('result_filter', 'web');
  params.set('extra_snippets', extraInfo ? 'true' : 'false');

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
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
    return { query, error: `Brave Web Search API error (${response.status}): ${errorText}` };
  }

  const data = await response.json();

  const results = (data.web?.results || []).map((item: any) => {
    const result: any = {
      title: item.title,
      url: item.url,
      description: item.description || '',
    };

    if (extraInfo && item.extra_snippets?.length) {
      result.extra_snippets = item.extra_snippets.slice(0, 2);
    }

    if (item.age) {
      result.posted_at = item.age;
    }

    return result;
  });

  return { query, results };
}

async function executeInternetSearch(args: any): Promise<any> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    return { error: "Brave API key is missing. Please set BRAVE_API_KEY in .env.local" };
  }

  const searches = args.searches || [];
  if (searches.length === 0) {
    return { error: "No searches provided for internet search." };
  }

  try {
    const searchPromises = searches.map((search: any) =>
      searchWeb(apiKey, search.query, search.count, search.extra_info).catch((err: any) => ({
        query: search.query,
        error: err.message
      }))
    );

    const results = await Promise.all(searchPromises);
    return withCitationReminder({ results });
  } catch (error: any) {
    return { error: `Unexpected error during internet search: ${error.message}` };
  }
}

export const internetSearchTools: Tool[] = [
  {
    definition: internetSearchDefinition,
    execute: executeInternetSearch,

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
