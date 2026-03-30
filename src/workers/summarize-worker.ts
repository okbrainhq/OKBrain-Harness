/**
 * Summarize Worker
 *
 * Processes summarization jobs using AI providers.
 * Streams responses through job events for real-time updates.
 */

import { registerWorker, ClaimedJob, WorkerContext } from '../lib/jobs';
import { getAIProvider } from '../lib/ai';
import { summarizeConversation } from '../lib/ai/summarize';
import {
  addChatEvent,
  getChatEvents,
  setConversationActiveJob,
} from '../lib/db';

export interface SummarizeJobInput {
  userId: string;
  conversationId: string;
}

async function handleSummarizeJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  const input = job.input as SummarizeJobInput;
  const { userId, conversationId } = input;

  console.log(`[SummarizeWorker] Processing job ${job.jobId} for conversation: ${conversationId}`);

  const ai = getAIProvider('gemini');

  // Build messages from chat events
  const chatEvents = await getChatEvents(conversationId);
  const messages = chatEvents
    .filter(e => e.kind === 'user_message' || e.kind === 'assistant_text' || e.kind === 'summary')
    .map(e => {
      let content: any;
      try { content = typeof e.content === 'string' ? JSON.parse(e.content) : e.content; } catch { content = e.content; }
      return {
        role: e.kind === 'user_message' ? 'user' : e.kind === 'summary' ? 'summary' : 'assistant',
        content: content.text || '',
        model: content.model,
      };
    });

  // Emit init event with role for SSR resume
  await ctx.emit('output', {
    type: 'init',
    conversationId,
    model: ai.getModelName(),
    role: 'summary',
  });

  // AbortController to stop the stream when stop is requested
  const abortController = new AbortController();

  let accumulatedResponse = '';

  try {
    await summarizeConversation(
      messages,
      async (chunk) => {
        // Check stop request and abort the stream
        if (await ctx.stopRequested()) {
          console.log(`[SummarizeWorker] Stop requested for job ${job.jobId}, aborting stream`);
          abortController.abort();
          return;
        }

        if (chunk.text) {
          accumulatedResponse += chunk.text;
          await ctx.emit('output', { text: chunk.text });
        }

        if (chunk.done) {
          // Write summary chat event
          const summaryEvt = await addChatEvent(conversationId, 'summary', {
            text: accumulatedResponse,
            model: ai.getModelName(),
          });
          let parsedContent: any;
          try { parsedContent = JSON.parse(summaryEvt.content); } catch { parsedContent = summaryEvt.content; }
          await ctx.emit('event_persisted', {
            seq: summaryEvt.seq,
            event_kind: 'summary',
            event: { id: summaryEvt.id, seq: summaryEvt.seq, kind: summaryEvt.kind, content: parsedContent, feedback: null, created_at: summaryEvt.created_at },
          });

          // Emit final done event
          await ctx.emit('output', {
            final: true,
            model: ai.getModelName(),
          });
        }
      },
      abortController.signal,
      userId
    );
  } catch (error) {
    console.error(`[SummarizeWorker] Stream error for job ${job.jobId}:`, error);
    await ctx.emit('output', {
      final: true,
      error: 'Failed to generate summary',
    });
    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(false);
    return;
  }

  // Check if stopped during streaming
  if (await ctx.stopRequested()) {
    await ctx.emit('output', {
      final: true,
      stopped: true,
    });
    await setConversationActiveJob(userId, conversationId, null);
    await ctx.complete(true);
    return;
  }

  await setConversationActiveJob(userId, conversationId, null);
  await ctx.complete(true);
}

registerWorker({
  jobType: 'summarize',
  pollIntervalMs: 100,
  maxConcurrency: 5,
  onJob: handleSummarizeJob,
  onError: (error, job) => {
    console.error('[SummarizeWorker] Job failed:', error, job?.jobId);
  },
});
