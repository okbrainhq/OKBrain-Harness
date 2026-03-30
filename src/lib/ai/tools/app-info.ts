import { Tool, ToolDefinition } from './types';
import { requireUserId } from './context';
import { resolveApp, getAppSecretKeys } from '../../db';
import { readFile } from '../../sandbox-fs';

const appInfoDefinition: ToolDefinition = {
  name: 'app_info',
  description: `Get app details: description, README content, and available secret keys (not values).

The README file describes the app's features, usage, and how to run it.
Use this to understand an app before running commands with run_app.
When adding features to an app, update the README to reflect the changes.`,
  parameters: {
    type: 'OBJECT',
    properties: {
      app_name: {
        type: 'STRING',
        description: 'The app name to inspect.',
      },
    },
    required: ['app_name'],
  },
};

async function executeAppInfo(args: { app_name: string }): Promise<any> {
  const userId = requireUserId();

  if (!args.app_name) {
    return { error: 'app_name is required.' };
  }

  const app = await resolveApp(userId, args.app_name);
  if (!app) {
    return { error: `App not found: ${args.app_name}` };
  }

  const secretKeys = await getAppSecretKeys(app.id);

  // Read README.md from app directory
  let readme: string | null = null;
  try {
    const result = await readFile(`apps/${app.id}/README.md`);
    readme = result.content;
  } catch {
    // README may not exist yet
  }

  return {
    id: app.id,
    title: app.title,
    description: app.description,
    secret_keys: secretKeys,
    readme: readme || 'No README.md found. Create one at app/README.md to document this app.',
  };
}

export const appInfoTools: Tool[] = [
  {
    definition: appInfoDefinition,
    execute: executeAppInfo,
  },
];
