/**
 * Highlights Worker
 *
 * Processes highlight generation jobs using Gemini AI.
 * Generates brief summaries of upcoming events for different time windows.
 */

import { registerWorker, ClaimedJob, WorkerContext } from '../lib/jobs';
import { getAIProvider, injectContextMessages } from '../lib/ai';
import { getUserMemory, getLatestFactSheet } from '../lib/db';
import type { FactSheetEntry } from '../lib/db';
import { getUpcomingEventsContext } from '../lib/ai/tools/events';

type HighlightView = 'today' | 'tomorrow' | 'week';

interface HighlightsInput {
  userId: string;
  view: HighlightView;
  userPrompt: string;
  location?: string;
}

const VIEW_PROMPTS: Record<HighlightView, (userPrompt: string) => string> = {
  today: (userPrompt) => `Generate a brief daily highlight for me. Focus on: ${userPrompt}

IMPORTANT RULES:
- Only include information for the NEXT 24 HOURS from now
- Write a SINGLE short paragraph (2-3 sentences max)
- NO headers & bullet points, lists by default
- Add bullet points or lists only if asked
- If you use lists, each item MUST be under 40 characters
- You may use **bold** for emphasis
- If nothing is happening in the next 24 hours, say so briefly
- Keep it under 70 words`,

  tomorrow: (userPrompt) => `Generate a brief highlight for the 24-48 hour window from now. Focus on: ${userPrompt}

IMPORTANT RULES:
- Only include information from 24 hours from now until 48 hours from now (exclude the next 24 hours)
- Write a SINGLE short paragraph (2-3 sentences max)
- NO headers & bullet points, lists by default
- Add bullet points or lists only if asked
- If you use lists, each item MUST be under 40 characters
- You may use **bold** for emphasis
- If nothing notable is happening in that window, say so briefly
- Keep it under 70 words`,

  week: (userPrompt) => `Generate a brief highlight for the rest of this week. Focus on: ${userPrompt}

IMPORTANT RULES:
- Only include information from 48 hours from now until the end of 7 days from now (exclude the next 48 hours)
- Write a SINGLE short paragraph (2-3 sentences max)
- NO headers & bullet points, lists by default
- Add bullet points or lists only if asked
- If you use lists, each item MUST be under 40 characters
- You may use **bold** for emphasis
- If nothing notable is happening in that window, say so briefly
- Keep it under 70 words`,
};

async function handleHighlightsJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  const input = job.input as HighlightsInput;
  const { userId, view, userPrompt, location } = input;

  console.log(`[HighlightsWorker] Processing job ${job.jobId} for view: ${view}`);

  // Build the prompt with context
  const message = VIEW_PROMPTS[view](userPrompt);

  // Get AI provider (using Gemini Flash for highlights)
  const ai = getAIProvider('gemini', { thinking: false });

  // Get context data
  const eventsContext = await getUpcomingEventsContext(userId, 10);
  const userMemory = await getUserMemory(userId);

  // Load facts from fact sheet
  let facts: Array<{ category: string; fact: string }> = [];
  const factSheet = await getLatestFactSheet(userId);
  if (factSheet) {
    const entries: FactSheetEntry[] = JSON.parse(factSheet.facts_json);
    facts = entries.map(e => ({ category: e.category, fact: e.fact }));
  } else {
    console.warn(`[HighlightsWorker] No fact sheet found for user ${userId}`);
  }

  // Build messages with context injected as message pairs
  const baseMessages = [{ role: 'user' as const, content: message }];
  const messages = injectContextMessages(baseMessages, {
    modelName: ai.getModelName(),
    userMemory,
    facts,
    eventsContext,
  });

  ctx.status({ phase: 'generating', view });

  // Stream the response
  let stopped = false;
  await ai.generateStream(
    messages,
    async (chunk) => {
      if (await ctx.stopRequested()) {
        console.log(`[HighlightsWorker] Stop requested for job ${job.jobId}`);
        stopped = true;
        return;
      }

      if (chunk.text) {
        await ctx.emit('output', { text: chunk.text });
      }
    },
    { thinking: true, location, userId }
  );

  if (stopped) {
    await ctx.emit('output', { text: '[Stopped]', final: true });
    await ctx.complete(true);
    return;
  }

  // Mark job as complete
  await ctx.complete(true);
}

registerWorker({
  jobType: 'highlights',
  pollIntervalMs: 500,
  maxConcurrency: 10,
  onJob: handleHighlightsJob,
  onError: (error, job) => {
    console.error('[HighlightsWorker] Job failed:', error, job?.jobId);
  },
});
