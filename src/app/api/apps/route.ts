import { NextResponse } from "next/server";
import { createApp, getFolder, getAppByTitle } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { getSession } from "@/lib/auth";
import { createDirectory, writeFile } from "@/lib/sandbox-fs";

const DEFAULT_DEV_MD = `# Development Guide

## Entry Point

The app MUST have an executable entry point at \`./run\`.

- \`./run\` is executed directly (not via bash), so it MUST start with the correct shebang line (e.g., \`#!/bin/bash\`, \`#!/usr/bin/env python3\`, \`#!/usr/bin/env node\`).
- Mark it executable: \`chmod +x ./run\`
- Other chats invoke the app via: \`./run <args>\` — they cannot run arbitrary commands.

## Testing

- Always create a test suite (e.g., \`test.sh\`).
- Run the test suite after every change.
- When adding a new feature, add corresponding tests.
- Tests should be e2e style — invoke \`./run\` with arguments and verify output.
- If the app uses a database, always use a separate test database.

## Workflow

1. Implement the change
2. Run the test suite
3. Fix any failures
4. Update README.md with any new CLI arguments or usage changes
`;

// POST /api/apps - Create a new app
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { title, folder_id } = await request.json();
    let targetFolderId: string | null = null;
    if (folder_id) {
      const folder = await getFolder(session.userId, folder_id);
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 400 });
      }
      targetFolderId = folder_id;
    }
    const appTitle = title || "Untitled App";
    const existing = await getAppByTitle(session.userId, appTitle);
    if (existing) {
      return NextResponse.json({ error: `An app with the name "${appTitle}" already exists` }, { status: 409 });
    }

    const id = uuid();
    const app = await createApp(session.userId, id, appTitle, targetFolderId);

    // Create app directory and seed DEV.md
    await createDirectory(`apps/${id}`);
    await writeFile(`apps/${id}/DEV.md`, DEFAULT_DEV_MD);

    return NextResponse.json(app);
  } catch (error) {
    console.error("Error creating app:", error);
    return NextResponse.json({ error: "Failed to create app" }, { status: 500 });
  }
}
