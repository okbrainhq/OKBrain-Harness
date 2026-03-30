import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  getConversation,
  getChatEvents,
  getDocument,
  getSharedLink,
  getSnapshotById,
  getUserById,
  getUserKV,
  getApp,
  getAppSecretKeys,
} from "@/lib/db";
import { readFile } from "@/lib/sandbox-fs";
import { getJob, getJobHistory } from "@/lib/jobs";
import { isValidModelId } from "@/lib/ai";
import ChatWrapper from "./ChatWrapper";

type HighlightView = "today" | "tomorrow" | "week";

function formatSharedConversationEvents(
  events: Array<{ kind: string; content: string }>
): string {
  return events
    .filter((e) => e.kind === "user_message" || e.kind === "assistant_text")
    .map((e) => {
      let content: any;
      try { content = typeof e.content === 'string' ? JSON.parse(e.content) : e.content; } catch { content = e.content; }
      const role = e.kind === "user_message" ? "User" : "Assistant";
      return `${role}: ${content.text || ''}`;
    })
    .join("\n\n");
}

// Reconstruct highlight text from job history output events
async function getHighlightFromJob(jobId: string): Promise<string | null> {
  const events = await getJobHistory(jobId);
  const outputEvents = events.filter(e => e.kind === 'output');
  if (outputEvents.length === 0) return null;

  return outputEvents
    .map(e => {
      const payload = JSON.parse(e.payload);
      return payload.text || '';
    })
    .join('');
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const docIdsParam = params.documentIds;
  const sharedLinkId = typeof params.sharedLinkId === "string" ? params.sharedLinkId : undefined;

  // Normalize docIds into an array
  const documentIds: string[] = [];
  if (docIdsParam) {
    if (Array.isArray(docIdsParam)) {
      documentIds.push(...docIdsParam);
    } else {
      documentIds.push(docIdsParam);
    }
  }

  const session = await getSession();
  if (!session) {
    const nextSearchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          nextSearchParams.append(key, item);
        }
      } else {
        nextSearchParams.set(key, value);
      }
    }
    const nextTarget = nextSearchParams.toString()
      ? `/?${nextSearchParams.toString()}`
      : "/";
    redirect(`/login?next=${encodeURIComponent(nextTarget)}`);
  }

  const user = await getUserById(session.userId);
  if (!user) {
    const nextSearchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          nextSearchParams.append(key, item);
        }
      } else {
        nextSearchParams.set(key, value);
      }
    }
    const nextTarget = nextSearchParams.toString()
      ? `/?${nextSearchParams.toString()}`
      : "/";
    redirect(`/login?next=${encodeURIComponent(nextTarget)}`);
  }

  const initialDocumentContexts: { id: string; title: string }[] = [];
  if (documentIds.length > 0 && session) {
    for (const id of documentIds) {
      const doc = await getDocument(session.userId, id);
      if (doc) {
        initialDocumentContexts.push({ id: doc.id, title: doc.title });
      }
    }
  }

  // Load app context if appId is provided
  const appIdParam = typeof params.appId === 'string' ? params.appId : undefined;
  const initialContentContexts: { title: string; content: string; sharedLinkId?: string }[] = [];
  let initialAppContext: { id: string; title: string } | null = null;

  if (appIdParam && session) {
    const app = await getApp(session.userId, appIdParam);
    if (app) {
      initialAppContext = { id: app.id, title: app.title };
      let readme: string | null = null;
      try {
        const result = await readFile(`apps/${appIdParam}/README.md`);
        readme = result.content;
      } catch { /* README may not exist yet */ }

      let devmd: string | null = null;
      try {
        const result = await readFile(`apps/${appIdParam}/DEV.md`);
        devmd = result.content;
      } catch { /* DEV.md may not exist yet */ }

      let secretKeys: string[] = [];
      try { secretKeys = await getAppSecretKeys(appIdParam); } catch {}

      const appContext = [
        `# App: ${app.title}`,
        app.description ? `\nDescription: ${app.description}` : '',
        `\nApp ID: ${app.id}`,
        secretKeys.length > 0 ? `\nAvailable secret env vars: ${secretKeys.join(', ')}` : '',
        readme ? `\n## README\n\n${readme}` : '\nNo README.md yet. Create README.md to document this app.',
        devmd ? `\n## DEV.md\n\n${devmd}` : '',
        `\n## Working on this app

- ALWAYS read DEV.md first and follow its instructions.
- Use read_file, write_file, patch_file, list_files, search_files for all file operations (reading, creating, editing, searching code). All paths are relative to ~ (home directory). App files are in the app/ directory (e.g. "app/run", "app/README.md", "app/src/index.js").
- Use run_shell_command ONLY for execution: running scripts, tests, git, npm, etc. — NOT for reading or editing files. The shell working directory is ~/app.
- You have full access to ~/ (home directory) for installing packages, using tools, etc.
- You don't have root/sudo access. Install things locally if needed.
- App secrets are injected as environment variables.
- The OKBRAIN_USERID environment variable is always available — it contains the current user's ID.

## CRITICAL: Keep README.md and DEV.md up to date

- README.md is ONLY for user-facing information: what the app does, CLI usage, arguments, and examples. Only add information relevant to the user of the app.
- DEV.md is for all development instructions: how to build, test, run the test suite, project structure, etc.
- You MUST update README.md whenever you add or change user-facing features, commands, or arguments.
- You MUST update DEV.md whenever you change the project structure, build process, testing approach, or development workflow.
- After adding or changing features, run the test suite, then update README.md and DEV.md as needed.
- Only put commands in the README that you have verified actually work by running them.`,
      ].filter(Boolean).join('\n');

      initialContentContexts.push({ title: `App: ${app.title}`, content: appContext });
    }
  }

  if (sharedLinkId) {
    const sharedLink = await getSharedLink(sharedLinkId);
    if (sharedLink) {
      if (sharedLink.type === "document") {
        const doc = await getDocument(sharedLink.user_id, sharedLink.resource_id);
        if (doc) {
          initialContentContexts.push({ title: doc.title, content: doc.content, sharedLinkId: sharedLink.id });
        }
      } else if (sharedLink.type === "snapshot") {
        const snapshot = await getSnapshotById(sharedLink.resource_id);
        if (snapshot) {
          initialContentContexts.push({ title: snapshot.title, content: snapshot.content, sharedLinkId: sharedLink.id });
        }
      } else if (sharedLink.type === "conversation") {
        const conversation = await getConversation(sharedLink.user_id, sharedLink.resource_id);
        const chatEvts = await getChatEvents(sharedLink.resource_id);
        if (conversation && chatEvts.length > 0) {
          initialContentContexts.push({
            title: conversation.title,
            content: formatSharedConversationEvents(chatEvts),
            sharedLinkId: sharedLink.id,
          });
        }
      }
    }
  }

  // Fetch verify model preference for SSR
  let initialVerifyModel: string | null = null;
  if (session) {
    const verifyModelKV = await getUserKV(session.userId, "verify:model");
    if (verifyModelKV?.value && isValidModelId(verifyModelKV.value)) {
      initialVerifyModel = verifyModelKV.value;
    }
  }

  // Fetch highlights for SSR using job system
  let initialHighlightsData = null;
  if (session) {
    const promptKV = await getUserKV(session.userId, "highlights:prompt");

    const views: Record<string, {
      highlight: string | null;
      lastRunAt: string | null;
      jobId: string;
      jobState: string | null;
      isRunning: boolean;
    }> = {};

    for (const view of ["today", "tomorrow", "week"] as HighlightView[]) {
      const jobId = `highlights:${session.userId}:${view}`;
      const job = await getJob(jobId);

      // Get highlight from job history if job succeeded
      const highlight = job?.state === 'succeeded'
        ? await getHighlightFromJob(jobId)
        : null;

      views[view] = {
        highlight,
        lastRunAt: job?.state === 'succeeded' ? job.updated_at : null,
        jobId,
        jobState: job?.state || null,
        isRunning: job?.state === 'running' || job?.state === 'stopping',
      };
    }

    initialHighlightsData = {
      prompt: promptKV?.value || "Show me events and interesting things.",
      views,
    };
  }

  return (
    <Suspense fallback={
      <div className="messages-container">
        <div className="empty-state">
          <h2>Loading...</h2>
        </div>
      </div>
    }>
      <ChatWrapper
        initialDocumentContexts={initialDocumentContexts}
        initialContentContexts={initialContentContexts}
        initialAppId={appIdParam || null}
        initialAppContext={initialAppContext}
        initialHighlightsData={initialHighlightsData}
        initialVerifyModel={initialVerifyModel}
      />
    </Suspense>
  );
}
