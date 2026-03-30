import { Tool, ToolDefinition } from './types';
import { requireUserId } from './context';
import { getAllApps } from '../../db';
import { readFile } from '../../sandbox-fs';

const discoverAppsDefinition: ToolDefinition = {
  name: 'discover_apps',
  description: `List available apps. Optionally filter by keyword.

Returns app names and descriptions. Keyword search matches title, description, and README content.
Use app_info to read the full README, or run_app to execute commands in an app's sandbox.`,
  parameters: {
    type: 'OBJECT',
    properties: {
      keyword: {
        type: 'STRING',
        description: 'Optional keyword to filter apps by title, description, or README content.',
      },
    },
  },
};

async function executeDiscoverApps(args: { keyword?: string }): Promise<any> {
  const userId = requireUserId();
  const allApps = await getAllApps(userId) as Array<{ id: string; title: string; description: string }>;

  if (!args.keyword) {
    return {
      apps: allApps.map(a => ({ name: a.title, description: a.description })),
    };
  }

  const kw = args.keyword.toLowerCase();

  // First pass: match title and description
  const titleDescMatches: typeof allApps = [];
  const remaining: typeof allApps = [];
  for (const a of allApps) {
    if (a.title.toLowerCase().includes(kw) || a.description.toLowerCase().includes(kw)) {
      titleDescMatches.push(a);
    } else {
      remaining.push(a);
    }
  }

  // Second pass: search README content for remaining apps
  const readmeMatches: typeof allApps = [];
  for (const a of remaining) {
    try {
      const result = await readFile(`apps/${a.id}/README.md`);
      if (result.content.toLowerCase().includes(kw)) {
        readmeMatches.push(a);
      }
    } catch {
      // No README or read error — skip
    }
  }

  const matched = [...titleDescMatches, ...readmeMatches];
  return {
    apps: matched.map(a => ({ name: a.title, description: a.description })),
  };
}

export const discoverAppsTools: Tool[] = [
  {
    definition: discoverAppsDefinition,
    execute: executeDiscoverApps,
  },
];
