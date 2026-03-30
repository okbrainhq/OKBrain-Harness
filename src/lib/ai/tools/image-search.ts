import { ToolDefinition, Tool } from './types';

function getBraveApiKey(): string {
  const apiKey = process.env.BRAVE_API_KEY || '';
  if (!apiKey) {
    console.warn('No Brave API key found. Set BRAVE_API_KEY in your .env.local file.');
  }
  return apiKey;
}

const imageSearchDefinition: ToolDefinition = {
  name: "image_search",
  description: `Search for images on the web. Use this when the user asks to see images, photos, pictures, or visual examples of something. Returns a list of image results with thumbnails and source URLs. You can provide multiple searches to cover different aspects of the topic.

IMPORTANT: After receiving results, display images using this EXACT format (do NOT use markdown images):
<images>
<image src="THUMBNAIL_URL" title="SHORT TITLE" link="PAGE_URL" />
</images>

Include 5-8 images. Use the thumbnail field for src and pageUrl for link.`,
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
              description: "The image search query. Max 400 characters and 50 words."
            },
            count: {
              type: "INTEGER",
              description: "Number of image results to return (1-20). Default is 5."
            }
          },
          required: ["query"]
        },
        description: "An array of image searches to execute in parallel. Each search has its own query and optional count."
      }
    },
    required: ["searches"]
  }
};

async function searchImages(apiKey: string, query: string, count: number): Promise<any> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    safesearch: 'off',
    country: 'ALL'
  });

  const response = await fetch(
    `https://api.search.brave.com/res/v1/images/search?${params.toString()}`,
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
    return { query, error: `Brave Image Search API error (${response.status}): ${errorText}` };
  }

  const data = await response.json();

  const results = (data.results || []).map((img: any) => ({
    title: img.title,
    url: img.url,
    source: img.source,
    pageUrl: img.meta_url?.path ? `${img.meta_url.scheme}://${img.meta_url.netloc}${img.meta_url.path}` : img.url,
    thumbnail: img.thumbnail?.src || null,
    image: {
      url: img.properties?.url || img.url,
      width: img.properties?.width || img.width || null,
      height: img.properties?.height || img.height || null,
    }
  }));

  return { query, results };
}

async function executeImageSearch(args: any): Promise<any> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    return { error: "Brave API key is missing. Please set BRAVE_API_KEY in .env.local" };
  }

  const searches = args.searches || [];
  if (searches.length === 0) {
    return { error: "No searches provided for image search." };
  }

  try {
    const searchPromises = searches.map((search: any) => {
      const query = search.query;
      const count = Math.min(Math.max(search.count || 5, 1), 20);
      return searchImages(apiKey, query, count).catch((err: any) => ({
        query,
        error: err.message
      }));
    });

    const results = await Promise.all(searchPromises);
    return { results };
  } catch (error: any) {
    return { error: `Unexpected error during image search: ${error.message}` };
  }
}

export const imageSearchTools: Tool[] = [
  { definition: imageSearchDefinition, execute: executeImageSearch }
];

export const imageSearchToolDefinitions: ToolDefinition[] = imageSearchTools.map(t => t.definition);

export async function executeImageSearchTool(name: string, args: any): Promise<any> {
  const tool = imageSearchTools.find(t => t.definition.name === name);
  if (!tool) {
    throw new Error(`Unknown Image Search tool: ${name}`);
  }
  return tool.execute(args);
}
