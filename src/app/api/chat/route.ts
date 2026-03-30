import { v4 as uuid } from "uuid";
import {
  createConversation,
  getConversation,
  getFolder,
  updateConversationResponseMode,
  updateConversationAIProvider,
  setConversationActiveJob,
  setConversationSourceSharedLink,
  addChatEvent,
  ResponseMode,
} from "@/lib/db";
import type { UserMessageContent } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createJob, startJob } from "@/lib/jobs";
import { rateLimit } from "@/lib/rate-limit";
import { ChatJobInput } from "@/workers/chat-worker";
import { AIFileData } from "@/lib/ai/types";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const userId = session.userId;

    // 30 messages per minute per user
    if (!rateLimit(`chat:${userId}`, 30, 60 * 1000)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      message,
      conversationId,
      thinking,
      mode,
      folderId,
      image,
      files,
      aiProvider = 'gemini',
      skipProviderUpdate,
      documentIds = [],
      contentContexts = [],
      location,
      appId,
    } = await request.json();

    // Prepare image data if provided
    const imageData = image ? { mimeType: image.mimeType, base64: image.base64 } : undefined;

    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate provider using the registry
    const { isValidModelId } = await import("@/lib/ai");
    if (!isValidModelId(aiProvider)) {
      return new Response(JSON.stringify({ error: "Invalid AI provider" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let currentConversationId = conversationId;
    let isNewConversation = false;
    let useMode: ResponseMode = mode === 'quick' ? 'quick' : 'detailed';
    let currentDocumentIds: string[] = Array.isArray(documentIds) ? documentIds : [];
    let currentAppId: string | null = typeof appId === 'string' ? appId : null;
    const currentContentContexts: { title: string; content: string }[] = Array.isArray(contentContexts)
      ? contentContexts
        .filter((ctx: any) => typeof ctx?.title === "string" && typeof ctx?.content === "string")
        .map((ctx: any) => ({ title: ctx.title, content: ctx.content }))
      : [];
    // Extract the shared link ID (first one with a sharedLinkId)
    const sourceSharedLinkId: string | undefined = Array.isArray(contentContexts)
      ? contentContexts.find((ctx: any) => ctx?.sharedLinkId)?.sharedLinkId
      : undefined;

    // Get existing conversation or create new one
    if (currentConversationId) {
      const conv = await getConversation(userId, currentConversationId);
      if (conv) {
        // Update provider if it changed
        if (conv.ai_provider !== aiProvider && !skipProviderUpdate) {
          await updateConversationAIProvider(userId, currentConversationId, aiProvider);
        }

        // Always update response mode from request
        useMode = mode === 'quick' ? 'quick' : 'detailed';
        await updateConversationResponseMode(userId, currentConversationId, useMode);

        // Use existing document ID from conversation if not provided in request
        if (currentDocumentIds.length === 0 && conv.document_ids && conv.document_ids.length > 0) {
          currentDocumentIds = conv.document_ids;
        }
        // Inherit app_id from existing conversation
        if (!currentAppId && conv.app_id) {
          currentAppId = conv.app_id;
        }
      } else {
        // Conversation not found or unauthorized
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else {
      currentConversationId = uuid();
      let targetFolderId: string | null = null;
      if (folderId) {
        const folder = await getFolder(userId, folderId);
        if (!folder) {
          return new Response(JSON.stringify({ error: "Folder not found" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        targetFolderId = folderId;
      }

      // Create conversation with optional default folder, provider, and app link
      await createConversation(userId, currentConversationId, "New Chat", false, useMode, targetFolderId, aiProvider, currentDocumentIds, currentAppId);
      isNewConversation = true;

      // Persist source shared link reference
      if (sourceSharedLinkId) {
        await setConversationSourceSharedLink(currentConversationId, sourceSharedLinkId);
      }
    }

    // Save user message as chat event
    const userMessageId = uuid();
    const userMessageEventContent: UserMessageContent = { text: message, model: aiProvider };
    if (files && Array.isArray(files) && files.length > 0) {
      userMessageEventContent.attachments = files.map((f: any) => ({
        name: f.fileName,
        uri: f.uri,
        mime_type: f.mimeType,
      }));
    }
    if (imageData) {
      userMessageEventContent.image = imageData;
    }
    await addChatEvent(currentConversationId, 'user_message', userMessageEventContent);

    // Convert files to AIFileData format for the job
    const fileData: AIFileData[] | undefined = files && Array.isArray(files) && files.length > 0
      ? files.map((f: any) => ({ fileUri: f.uri, mimeType: f.mimeType }))
      : undefined;

    // Create and start job
    const job = await createJob('chat', undefined, userId);

    const jobInput: ChatJobInput = {
      userId,
      conversationId: currentConversationId,
      userMessageId,
      message,
      thinking: Boolean(thinking),
      mode: useMode,
      aiProvider,
      location,
      documentIds: currentDocumentIds,
      contentContexts: currentContentContexts,
      fileData,
      imageData,
      appId: currentAppId,
    };

    await startJob(job.id, jobInput);

    // Set active job ID on conversation for SSR resume
    await setConversationActiveJob(userId, currentConversationId, job.id);

    return new Response(JSON.stringify({
      jobId: job.id,
      conversationId: currentConversationId,
      isNewConversation,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process message" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
