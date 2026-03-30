import { getSession } from "@/lib/auth";
import {
  getConversation,
  getConversationDocuments,
  getSharedLink,
  getUserKV,
  getLatestActiveChatYieldSessionForConversation,
  getAllActiveChatYieldSessionsForConversation,
  getChatYieldSessionByResumeJobId,
  getChatEvents,
  getConversationToolJobsByParentJob,
  setConversationActiveJob,
  getApp,
} from "@/lib/db";
import { getJob, readLogSince } from "@/lib/jobs";
import { isValidModelId } from "@/lib/ai";
import EventChatView from "../../../components/events/EventChatView";
import { redirect } from "next/navigation";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  const conversation = await getConversation(session.userId, conversationId);
  if (!conversation) {
    redirect('/');
  }

  const docs = await getConversationDocuments(session.userId, conversationId);
  const initialDocumentContexts = docs.map(doc => ({ id: doc.id, title: doc.title }));

  // Load app context if this is an app chat
  let initialAppContext: { id: string; title: string } | null = null;
  if (conversation.app_id) {
    const app = await getApp(session.userId, conversation.app_id);
    if (app) {
      initialAppContext = { id: app.id, title: app.title };
    }
  }

  // Load source shared link if present
  let initialContentContexts: { title: string; content: string; sharedLinkId: string }[] | undefined;
  if (conversation.source_shared_link_id) {
    const sharedLink = await getSharedLink(conversation.source_shared_link_id);
    if (sharedLink) {
      // Resolve title from the shared resource
      let title = 'Shared Content';
      if (sharedLink.type === 'document') {
        const { getDocument } = await import("@/lib/db");
        const doc = await getDocument(sharedLink.user_id, sharedLink.resource_id);
        if (doc) title = doc.title;
      } else if (sharedLink.type === 'snapshot') {
        const { getSnapshotById } = await import("@/lib/db");
        const snap = await getSnapshotById(sharedLink.resource_id);
        if (snap) title = snap.title;
      } else if (sharedLink.type === 'conversation') {
        const { getConversation: getConv } = await import("@/lib/db");
        const conv = await getConv(sharedLink.user_id, sharedLink.resource_id);
        if (conv) title = conv.title;
      }
      initialContentContexts = [{
        title,
        content: '',
        sharedLinkId: conversation.source_shared_link_id,
      }];
    }
  }

  // Fetch verify model preference for SSR
  let initialVerifyModel: string | null = null;
  const verifyModelKV = await getUserKV(session.userId, "verify:model");
  if (verifyModelKV?.value && isValidModelId(verifyModelKV.value)) {
    initialVerifyModel = verifyModelKV.value;
  }

  // Load chat events
  const chatEvents = await getChatEvents(conversationId);

  // Parse content JSON for each event
  const parsedEvents = chatEvents.map((e: any) => ({
    ...e,
    content: (() => {
      try {
        return typeof e.content === 'string' ? JSON.parse(e.content) : e.content;
      } catch {
        return e.content;
      }
    })(),
  }));

  // Build SSR streaming state
  let initialActiveJobId: string | null = null;
  let initialStreamingContent = "";
  let initialStreamingThoughts = "";
  let initialStreamingStatus = "";
  let initialLastJobSeq = 0;
  let initialYieldWaiting = false;
  let initialYieldedToolJobs: { toolJobId: string; toolName: string; command?: string; callId?: string; state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout'; sinceSeq: number }[] = [];

  let activeJobHandled = false;
  if (conversation.active_job_id) {
    const activeJob = await getJob(conversation.active_job_id);
    if (activeJob && (activeJob.state === 'running' || activeJob.state === 'idle')) {
      activeJobHandled = true;
      initialActiveJobId = activeJob.id;
      const logEvents = readLogSince(activeJob.id, 0);

      initialStreamingContent = logEvents
        .filter((e: { kind: string }) => e.kind === 'output')
        .map((e: { payload: any }) => e.payload?.text || "")
        .join("");

      initialStreamingThoughts = logEvents
        .filter((e: { kind: string }) => e.kind === 'thought')
        .map((e: { payload: any }) => e.payload?.text || "")
        .join("");

      const resumeSession = await getChatYieldSessionByResumeJobId(activeJob.id);
      if (resumeSession) {
        initialStreamingContent = `${resumeSession.partial_output || ''}${initialStreamingContent}`;
        initialStreamingThoughts = `${resumeSession.partial_thoughts || ''}${initialStreamingThoughts}`;
      }

      const statusEvents = logEvents.filter((e: { kind: string }) => e.kind === 'status');
      if (statusEvents.length > 0) {
        initialStreamingStatus = statusEvents[statusEvents.length - 1].payload?.status || "";
      }

      if (logEvents.length > 0) {
        initialLastJobSeq = logEvents[logEvents.length - 1].seq;
      }
    } else {
      // Job is dead (crashed/stopped) — clear the stale reference so the conversation isn't stuck
      await setConversationActiveJob(session.userId, conversationId, null);
    }
  }

  // Check for active yield sessions (also runs after clearing a stale active_job_id)
  if (!activeJobHandled) {
    const activeYieldSessions = await getAllActiveChatYieldSessionsForConversation(conversationId);
    if (activeYieldSessions.length > 0) {
      initialYieldWaiting = true;
      initialStreamingStatus = 'Waiting for tools to complete';
      // Use the latest session for partial output/thoughts
      const latestSession = activeYieldSessions[activeYieldSessions.length - 1];
      initialStreamingContent = latestSession.partial_output || '';
      initialStreamingThoughts = latestSession.partial_thoughts || '';

      // Load tool jobs from ALL active yield sessions
      const allToolJobs = await Promise.all(
        activeYieldSessions.map((s: any) => getConversationToolJobsByParentJob(s.origin_chat_job_id))
      );
      const seen = new Set<string>();
      initialYieldedToolJobs = allToolJobs
        .flat()
        .filter((tj: any) => {
          if (seen.has(tj.job_id)) return false;
          seen.add(tj.job_id);
          return tj.state === 'running' || tj.state === 'succeeded' || tj.state === 'failed';
        })
        .map((tj: any) => {
          let command: string | undefined;
          let callId: string | undefined;
          try {
            const meta = tj.metadata ? JSON.parse(tj.metadata) : undefined;
            command = meta?.command;
            callId = meta?.callId;
          } catch { }
          return {
            toolJobId: tj.job_id,
            toolName: tj.tool_name,
            command,
            callId,
            state: tj.state as 'running' | 'succeeded' | 'failed',
            sinceSeq: 0,
          };
        });
    }
  }

  return (
    <EventChatView
      initialConversationId={conversationId}
      initialEvents={parsedEvents}
      initialConversation={conversation ? {
        ...conversation,
        folder_id: conversation.folder_id ?? null,
        grounding_enabled: conversation.grounding_enabled ?? 0,
        response_mode: conversation.response_mode || 'detailed',
        ai_provider: conversation.ai_provider || 'gemini',
        document_ids: conversation.document_ids || [],
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      } : null}
      initialActiveJobId={initialActiveJobId}
      initialLastJobSeq={initialLastJobSeq}
      initialStreamingContent={initialStreamingContent}
      initialStreamingThoughts={initialStreamingThoughts}
      initialStreamingStatus={initialStreamingStatus}
      initialYieldWaiting={initialYieldWaiting}
      initialYieldedToolJobs={initialYieldedToolJobs}
      initialVerifyModel={initialVerifyModel}
      initialDocumentContexts={initialDocumentContexts}
      initialContentContexts={initialContentContexts}
      initialAppId={conversation.app_id || null}
      initialAppContext={initialAppContext}
    />
  );
}
