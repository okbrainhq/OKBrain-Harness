/**
 * Fact Sheet Daily Rebuild Worker
 *
 * Performs an incremental rebuild of fact sheets using Gemini.
 * Uses three inputs:
 * 1. Last Gemini fact sheet (quality baseline)
 * 2. Current fact sheet (latest Qwen-merged)
 * 3. All facts extracted since last daily rebuild
 */

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { registerWorker, ClaimedJob, WorkerContext } from '../lib/jobs';
import {
  getUserIdsWithFacts,
  getLatestFactSheet,
  getLatestFactSheetBySource,
  getRecentFactsByHours,
  getUserFacts,
  saveFactSheet,
  deleteOldFactSheets,
} from '../lib/db';
import type { FactSheetEntry } from '../lib/db';
import { randomUUID } from 'crypto';
import { logGeminiUsage } from '../lib/ai/adapters/gemini-adapter';
import { registry } from '../lib/ai/registry';

const LOG_PREFIX = '[FactSheetRebuild]';

const CATEGORY_MAX_FACTS: Record<string, number> = {
  core: 30,
  technical: 25,
  project: 25,
  transient: 40,
};

const MAX_FACT_CHARS = 120;

async function handleFactSheetRebuildJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  console.log(`${LOG_PREFIX} Job ${job.jobId} started`);

  const userIds = await getUserIdsWithFacts();

  if (userIds.length === 0) {
    console.log(`${LOG_PREFIX} No users with facts found`);
    await ctx.emit('output', { message: 'No users with facts' });
    await ctx.complete(true);
    return;
  }

  console.log(`${LOG_PREFIX} Rebuilding fact sheets for ${userIds.length} users`);

  for (const userId of userIds) {
    if (await ctx.stopRequested()) {
      console.log(`${LOG_PREFIX} Stop requested, aborting`);
      await ctx.complete(true);
      return;
    }

    try {
      ctx.status({ message: `Rebuilding for user ${userId}` });
      await rebuildFactSheetForUser(userId);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error rebuilding fact sheet for user ${userId}:`, error);
    }

    // Clean up old fact sheets
    try {
      await deleteOldFactSheets(userId);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error cleaning up old fact sheets for user ${userId}:`, error);
    }
  }

  console.log(`${LOG_PREFIX} Done rebuilding for ${userIds.length} users`);
  await ctx.emit('output', { rebuiltCount: userIds.length });
  await ctx.complete(true);
}

async function rebuildFactSheetForUser(userId: string): Promise<void> {
  console.log(`${LOG_PREFIX} Rebuilding fact sheet for user ${userId}`);

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn(`${LOG_PREFIX} GOOGLE_API_KEY not set, skipping rebuild`);
    return;
  }

  // Load last Gemini fact sheet (quality baseline)
  const lastGeminiSheet = await getLatestFactSheetBySource(userId, 'gemini');
  const lastGeminiEntries: FactSheetEntry[] = lastGeminiSheet
    ? JSON.parse(lastGeminiSheet.facts_json)
    : [];

  // Load current (latest) fact sheet
  const currentSheet = await getLatestFactSheet(userId);
  const currentEntries: FactSheetEntry[] = currentSheet
    ? JSON.parse(currentSheet.facts_json)
    : [];

  // Load all facts for the user (raw material)
  const allFacts = await getUserFacts(userId);
  if (allFacts.length === 0) {
    console.log(`${LOG_PREFIX} No facts found for user ${userId}, skipping rebuild`);
    return;
  }

  // Group all inputs by category
  const categories = ['core', 'technical', 'project', 'transient'];
  const mergedEntries: FactSheetEntry[] = [];

  const client = new GoogleGenAI({ apiKey });
  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  for (const category of categories) {
    const maxFacts = CATEGORY_MAX_FACTS[category] || 25;

    const geminiCategoryFacts = lastGeminiEntries
      .filter(e => e.category === category)
      .map(e => e.fact);

    const currentCategoryFacts = currentEntries
      .filter(e => e.category === category)
      .map(e => e.fact);

    const rawCategoryFacts = allFacts
      .filter(f => f.category === category)
      .map(f => f.fact);

    // Skip if no facts at all for this category
    if (geminiCategoryFacts.length === 0 && currentCategoryFacts.length === 0 && rawCategoryFacts.length === 0) {
      continue;
    }

    let prompt = `You are rebuilding a comprehensive ${category} fact sheet about a user.\n\n`;

    if (geminiCategoryFacts.length > 0) {
      prompt += `Previous quality-reviewed ${category} facts:\n${geminiCategoryFacts.join('\n')}\n\n`;
    }

    if (currentCategoryFacts.length > 0) {
      prompt += `Current ${category} facts (incrementally merged since last review):\n${currentCategoryFacts.join('\n')}\n\n`;
    }

    if (rawCategoryFacts.length > 0) {
      prompt += `All raw extracted ${category} facts (may contain duplicates):\n${rawCategoryFacts.join('\n')}\n\n`;
    }

    prompt += `Create the definitive ${category} fact sheet by:
- Merging all sources into a clean, deduplicated list
- Resolving contradictions (newer/more specific facts win)
- Removing clearly outdated facts
- Keeping the best wording for each fact
- Ordering by importance/relevance
- Max ${maxFacts} facts
- Each fact MUST be a single concise statement under ${MAX_FACT_CHARS} characters
- Keep each fact atomic — do NOT combine multiple topics or details into one fact
- It is perfectly fine to drop less important facts to stay within limits. Dropping is better than compressing multiple facts into one long entry.
- Respond with ONLY the merged facts, one fact per line — no bullets, no numbering, no extra formatting`;

    try {
      let fullResponse = '';
      let lastUsageMetadata: any = null;

      const stream = await client.models.generateContentStream({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          thinkingConfig: {
            includeThoughts: false,
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });

      for await (const chunk of stream) {
        if (chunk.text) fullResponse += chunk.text;
        if (chunk.usageMetadata) lastUsageMetadata = chunk.usageMetadata;
      }

      if (lastUsageMetadata) {
        const pricing = registry.getAllModels().find(m => m.apiModel === modelName)?.pricing;
        logGeminiUsage('FactSheetRebuild', lastUsageMetadata, modelName, pricing);
      }

      const facts = parseMergeResponse(fullResponse);
      for (const fact of facts) {
        mergedEntries.push({ category, fact });
      }

      console.log(`${LOG_PREFIX} User ${userId} ${category}: ${facts.length} facts`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Gemini rebuild failed for ${category}, keeping current:`, error);
      // Fall back to current entries for this category
      for (const fact of currentCategoryFacts) {
        mergedEntries.push({ category, fact });
      }
    }
  }

  // Enforce character limit on all entries, including those from fallback paths
  const lengthFiltered = mergedEntries.filter(entry => {
    if (entry.fact.length > MAX_FACT_CHARS) {
      console.log(`${LOG_PREFIX} Dropping oversized fact (${entry.fact.length} chars): ${entry.fact.substring(0, 80)}...`);
      return false;
    }
    return true;
  });

  // Enforce per-category count limits
  const catCounts: Record<string, number> = {};
  const finalEntries = lengthFiltered.filter(entry => {
    const max = CATEGORY_MAX_FACTS[entry.category] || 25;
    catCounts[entry.category] = (catCounts[entry.category] || 0) + 1;
    return catCounts[entry.category] <= max;
  });

  // Save rebuilt fact sheet
  const sheetId = randomUUID();
  const factsJson = JSON.stringify(finalEntries);
  await saveFactSheet(sheetId, userId, factsJson, null, finalEntries.length, 'gemini');
  console.log(`${LOG_PREFIX} Saved rebuilt fact sheet ${sheetId}: ${finalEntries.length} facts`);
}

function parseMergeResponse(response: string): string[] {
  const facts = response
    .split('\n')
    .map(line => line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(line => line.length > 0);

  // Hard-enforce character limit — drop facts the model failed to shorten
  const filtered = facts.filter(fact => fact.length <= MAX_FACT_CHARS);
  if (filtered.length < facts.length) {
    console.log(
      `${LOG_PREFIX} Dropped ${facts.length - filtered.length} facts exceeding ${MAX_FACT_CHARS} chars`
    );
  }
  return filtered;
}

registerWorker({
  jobType: 'fact-sheet-daily-rebuild',
  pollIntervalMs: 500,
  maxConcurrency: 1,
  onJob: handleFactSheetRebuildJob,
  onError: (error, job) => {
    console.error(`${LOG_PREFIX} Job failed:`, error, job?.jobId);
  },
});
