import { ToolDefinition, Tool } from './types';

function getTavilyApiKey(): string {
  const apiKey = process.env.TAVILY_API_KEY || '';
  if (!apiKey) {
    console.warn('No Tavily API key found. Set TAVILY_API_KEY in your .env.local file.');
  }
  return apiKey;
}

// We tried using local fetching
// It works, but the it adds a lot of data to the context and it cost more
// So, having this is simpler & cheaper
const readUrlDefinition: ToolDefinition = {
  name: "read_url",
  description: "Read and extract the main content from web pages. Use this when you need the full content of specific URLs found via internet_search or news_search.",
  parameters: {
    type: "OBJECT",
    properties: {
      urls: {
        type: "ARRAY",
        items: {
          type: "STRING"
        },
        description: "An array of URLs to extract content from."
      }
    },
    required: ["urls"]
  }
};

async function readSingleUrl(
  apiKey: string,
  url: string
): Promise<{ url: string; content?: string; error?: string }> {
  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, urls: [url] }),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) {
      return { url, error: 'No content extracted' };
    }
    const content = result.raw_content || '';
    return { url, content };
  } catch (err: any) {
    return { url, error: `Failed to read URL: ${err.message}` };
  }
}

async function executeReadUrl(args: any): Promise<any> {
  const urls = args.urls || [];

  if (urls.length === 0) {
    return { error: "No URLs provided for extraction." };
  }

  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    return { error: "Tavily API key is missing. Please set TAVILY_API_KEY in .env.local" };
  }

  try {
    const results = await Promise.all(
      urls.map((url: string) => readSingleUrl(apiKey, url))
    );
    return { results };
  } catch (error: any) {
    return { error: `Unexpected error during URL reading: ${error.message}` };
  }
}

export const readUrlTools: Tool[] = [
  { definition: readUrlDefinition, execute: executeReadUrl }
];
