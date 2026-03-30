import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { randomUUID } from 'crypto';
import {
  getRecentFactsByHours,
  getLatestFactSheet,
  saveFactSheet,
} from '@/lib/db';
import type { FactSheetEntry } from '@/lib/db';
import type { ExtractedFact } from './facts';
import { callOllama } from './ollama-api';
import { isOllamaAvailable } from './embeddings';
import { logGeminiUsage } from './adapters/gemini-adapter';
import { registry } from './registry';

const LOG_PREFIX = '[FactSheet]';
const OLLAMA_MERGE_MODEL = 'qwen3.5:9b';

const CATEGORY_MAX_FACTS: Record<string, number> = {
  core: 30,
  technical: 25,
  project: 25,
  transient: 40,
};

const MAX_FACT_CHARS = 120;

export async function quickMergeFactSheet(
  userId: string,
  newFacts: ExtractedFact[]
): Promise<void> {
  console.log(`${LOG_PREFIX} Quick merge for user ${userId}: ${newFacts.length} new facts`);

  const currentSheet = await getLatestFactSheet(userId);
  const currentEntries: FactSheetEntry[] = currentSheet
    ? JSON.parse(currentSheet.facts_json)
    : [];

  const currentByCategory = new Map<string, string[]>();
  for (const entry of currentEntries) {
    const list = currentByCategory.get(entry.category) || [];
    list.push(entry.fact);
    currentByCategory.set(entry.category, list);
  }

  const newByCategory = new Map<string, string[]>();
  for (const fact of newFacts) {
    const list = newByCategory.get(fact.category) || [];
    list.push(fact.fact);
    newByCategory.set(fact.category, list);
  }

  const recentFacts = await getRecentFactsByHours(userId, 6);
  const recentByCategory = new Map<string, string[]>();
  for (const fact of recentFacts) {
    const list = recentByCategory.get(fact.category) || [];
    list.push(fact.fact);
    recentByCategory.set(fact.category, list);
  }

  const ollamaAvailable = await isOllamaAvailable();
  const mergedEntries: FactSheetEntry[] = [];
  const categories = ['core', 'technical', 'project', 'transient'];

  for (const category of categories) {
    const newCategoryFacts = newByCategory.get(category);
    const currentCategoryFacts = currentByCategory.get(category) || [];

    if (!newCategoryFacts || newCategoryFacts.length === 0) {
      for (const fact of currentCategoryFacts) {
        mergedEntries.push({ category, fact });
      }
      continue;
    }

    const maxFacts = CATEGORY_MAX_FACTS[category] || 25;
    const recentCategoryFacts = recentByCategory.get(category) || [];

    try {
      let merged: string[] = [];
      const maxMergeAttempts = 2;

      for (let attempt = 1; attempt <= maxMergeAttempts; attempt++) {
        merged = await mergeCategoryFacts(
          category,
          currentCategoryFacts,
          recentCategoryFacts,
          newCategoryFacts,
          maxFacts,
          ollamaAvailable
        );

        if (merged.length > 0 || currentCategoryFacts.length === 0) {
          break;
        }

        console.warn(
          `${LOG_PREFIX} Merge returned empty for ${category} (had ${currentCategoryFacts.length} existing), attempt ${attempt}/${maxMergeAttempts}`
        );
      }

      if (merged.length === 0 && currentCategoryFacts.length > 0) {
        console.warn(`${LOG_PREFIX} Merge still empty for ${category} after retries, keeping existing`);
        for (const fact of currentCategoryFacts) {
          mergedEntries.push({ category, fact });
        }
      } else {
        for (const fact of merged) {
          mergedEntries.push({ category, fact });
        }
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Merge failed for category ${category}, keeping existing:`, error);
      for (const fact of currentCategoryFacts) {
        mergedEntries.push({ category, fact });
      }
    }
  }

  // Enforce character limit on all entries, including those that bypassed the model
  const lengthFiltered = mergedEntries.filter((entry) => {
    if (entry.fact.length > MAX_FACT_CHARS) {
      console.log(`${LOG_PREFIX} Dropping oversized fact (${entry.fact.length} chars): ${entry.fact.substring(0, 80)}...`);
      return false;
    }
    return true;
  });

  // Enforce per-category count limits
  const catCounts: Record<string, number> = {};
  const finalEntries = lengthFiltered.filter((entry) => {
    const max = CATEGORY_MAX_FACTS[entry.category] || 25;
    catCounts[entry.category] = (catCounts[entry.category] || 0) + 1;
    return catCounts[entry.category] <= max;
  });

  const sheetId = randomUUID();
  const factsJson = JSON.stringify(finalEntries);
  await saveFactSheet(sheetId, userId, factsJson, null, finalEntries.length, 'qwen');
  console.log(`${LOG_PREFIX} Saved quick-merged fact sheet ${sheetId}: ${finalEntries.length} facts`);
}

async function mergeCategoryFacts(
  category: string,
  currentFacts: string[],
  recentFacts: string[],
  newFacts: string[],
  maxFacts: number,
  ollamaAvailable: boolean
): Promise<string[]> {
  const prompt = buildMergePrompt(category, currentFacts, recentFacts, newFacts, maxFacts);

  const response = ollamaAvailable
    ? await mergeWithOllama(prompt)
    : await mergeWithGemini(prompt);

  return parseMergeResponse(response);
}

function buildMergePrompt(
  category: string,
  currentFacts: string[],
  recentFacts: string[],
  newFacts: string[],
  maxFacts: number
): string {
  let prompt = '';

  if (currentFacts.length > 0) {
    prompt += `Here are the current ${category} facts about the user:\n${currentFacts.join('\n')}\n\n`;
  }

  if (recentFacts.length > 0) {
    prompt += `Here are ${category} facts extracted in the last few hours (may contain repeats — repetition signals importance):\n${recentFacts.join('\n')}\n\n`;
  }

  prompt += `Here are newly extracted ${category} facts from the MOST RECENT conversations:\n${newFacts.join('\n')}\n\n`;

  prompt += `Merge the new facts into the existing list.
- If a new fact duplicates an existing one, keep the better wording
- If a new fact contradicts an existing one, the new fact wins
- If the list is full, drop the least relevant existing fact to make room for an important new one
- Drop facts that seem outdated or superseded
- Max ${maxFacts} facts
- Each fact MUST be a single concise statement under ${MAX_FACT_CHARS} characters
- Keep each fact atomic — do NOT combine multiple topics or details into one fact
- It is perfectly fine to drop less important facts to stay within limits. Dropping is better than compressing multiple facts into one long entry.
- Do NOT add labels, tags, or annotations like "(High Priority)" to facts — keep them as plain statements
- Respond with ONLY the merged facts, one fact per line — no bullets, no numbering, no extra formatting`;

  return prompt;
}

async function mergeWithOllama(prompt: string): Promise<string> {
  const result = await callOllama(
    [{ role: 'user', content: prompt }],
    { model: OLLAMA_MERGE_MODEL, thinking: false, samplingPreset: 'qwen3.5-reasoning' }
  );
  console.log(`${LOG_PREFIX} Ollama merge: prompt=${result.promptTokens} output=${result.outputTokens}`);
  return result.text;
}

async function mergeWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set');
  }

  const client = new GoogleGenAI({ apiKey });
  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

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
    logGeminiUsage('FactSheetMerge', lastUsageMetadata, modelName, pricing);
  }

  return fullResponse;
}

function parseMergeResponse(response: string): string[] {
  const facts = response
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);

  // Hard-enforce character limit — drop facts the model failed to shorten
  const filtered = facts.filter((fact) => fact.length <= MAX_FACT_CHARS);
  if (filtered.length < facts.length) {
    console.log(
      `${LOG_PREFIX} Dropped ${facts.length - filtered.length} facts exceeding ${MAX_FACT_CHARS} chars`
    );
  }
  return filtered;
}
