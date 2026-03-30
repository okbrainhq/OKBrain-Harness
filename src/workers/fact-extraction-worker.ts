/**
 * Fact Extraction Worker
 *
 * Active flow only:
 * - extract facts per conversation
 * - save all extracted facts as new
 * - embed them for search
 * - merge them into the running fact sheet
 */

import { registerWorker, ClaimedJob, WorkerContext } from '../lib/jobs';
import {
  getConversationsForFactExtraction,
  addFact,
  addFactExtraction,
  updateConversationFactExtractedAt,
  saveFactEmbedding,
} from '../lib/db';
import type { Fact } from '../lib/db';
import { extractFactsSimpleForUser } from '../lib/ai/facts';
import type { ExtractedFact } from '../lib/ai/facts';
import { quickMergeFactSheet } from '../lib/ai/fact-sheet';
import { isOllamaAvailable, embedDocument, embedDocumentBatch, isEmbeddingsEnabled } from '../lib/ai/embeddings';
import { randomUUID } from 'crypto';

const LOG_PREFIX = '[FactExtraction]';
const EXTRACTION_METHOD = 'ai-merge';

async function saveNewFactsForUser(
  userId: string,
  conversationId: string,
  facts: ExtractedFact[]
): Promise<Fact[]> {
  const created: Fact[] = [];

  for (const fact of facts) {
    try {
      const factId = randomUUID();
      await addFact(userId, factId, fact.category, fact.fact);
      await addFactExtraction(randomUUID(), factId, conversationId);
      created.push({
        id: factId,
        user_id: userId,
        category: fact.category,
        fact: fact.fact,
        created_at: new Date().toISOString(),
        extraction_count: 1,
      });
    } catch (error: any) {
      if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        console.warn(
          `${LOG_PREFIX} Skipping fact save for conversation ${conversationId}: referenced row was deleted`
        );
        continue;
      }
      throw error;
    }
  }

  await updateConversationFactExtractedAt(conversationId);
  return created;
}

async function embedNewFacts(facts: Fact[], userId: string): Promise<void> {
  if (facts.length === 0) return;

  if (!isEmbeddingsEnabled()) {
    console.log(`${LOG_PREFIX} Embeddings disabled, skipping embedding for ${facts.length} facts`);
    return;
  }

  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) {
    console.log(`${LOG_PREFIX} Ollama unavailable, skipping embedding for ${facts.length} facts`);
    return;
  }

  try {
    if (facts.length === 1) {
      const embedding = await embedDocument(facts[0].fact);
      await saveFactEmbedding(facts[0].id, userId, embedding);
    } else {
      const embeddings = await embedDocumentBatch(facts.map((fact) => fact.fact));
      for (let i = 0; i < facts.length; i++) {
        await saveFactEmbedding(facts[i].id, userId, embeddings[i]);
      }
    }
    console.log(`${LOG_PREFIX} Embedded ${facts.length} facts`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Embedding failed (non-fatal):`, error);
  }
}

async function handleFactExtractionJob(job: ClaimedJob, ctx: WorkerContext): Promise<void> {
  console.log(`${LOG_PREFIX} Job ${job.jobId} started (method: ${EXTRACTION_METHOD})`);

  const conversations = await getConversationsForFactExtraction();

  if (conversations.length === 0) {
    console.log(`${LOG_PREFIX} No eligible conversations found`);
    await ctx.emit('output', { message: 'No eligible conversations' });
    await ctx.complete(true);
    return;
  }

  const byUser = new Map<string, typeof conversations>();
  for (const conversation of conversations) {
    const list = byUser.get(conversation.user_id) || [];
    list.push(conversation);
    byUser.set(conversation.user_id, list);
  }

  console.log(`${LOG_PREFIX} Found ${conversations.length} conversations for ${byUser.size} users`);

  let totalNew = 0;
  let totalProcessed = 0;
  let conversationIndex = 0;

  for (const [userId, userConversations] of byUser) {
    console.log(`${LOG_PREFIX} Processing user ${userId}: ${userConversations.length} conversations`);

    const allNewFacts: ExtractedFact[] = [];
    const allCreatedFacts: Fact[] = [];

    for (const conversation of userConversations) {
      conversationIndex++;

      if (await ctx.stopRequested()) {
        console.log(`${LOG_PREFIX} Stop requested, aborting`);
        await ctx.complete(true);
        return;
      }

      ctx.status({ message: `Extracting ${conversationIndex}/${conversations.length}` });
      console.log(`${LOG_PREFIX} Extracting facts from conversation ${conversation.id}...`);

      try {
        const extracted = await extractFactsSimpleForUser(userId, conversation.id);
        if (extracted.length === 0) {
          console.log(`${LOG_PREFIX} Conversation ${conversation.id}: no facts found`);
          await updateConversationFactExtractedAt(conversation.id);
          totalProcessed++;
          continue;
        }

        console.log(`${LOG_PREFIX} Conversation ${conversation.id}: extracted ${extracted.length} facts`);

        const created = await saveNewFactsForUser(userId, conversation.id, extracted);
        allNewFacts.push(...extracted);
        allCreatedFacts.push(...created);
        totalNew += created.length;
        totalProcessed++;
      } catch (error) {
        console.error(`${LOG_PREFIX} Error extracting from conversation ${conversation.id}:`, error);
        totalProcessed++;
      }
    }

    if (allCreatedFacts.length > 0) {
      ctx.status({ message: `Embedding ${allCreatedFacts.length} facts...` });
      await embedNewFacts(allCreatedFacts, userId);
    }

    if (allNewFacts.length > 0) {
      try {
        ctx.status({ message: `Merging ${allNewFacts.length} facts into fact sheet...` });
        await quickMergeFactSheet(userId, allNewFacts);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error merging fact sheet for user ${userId}:`, error);
      }
    }
  }

  console.log(`${LOG_PREFIX} Done. Processed ${totalProcessed} conversations, ${totalNew} new facts`);

  await ctx.emit('output', {
    processed: totalProcessed,
    newFacts: totalNew,
  });

  await ctx.complete(true);
}

registerWorker({
  jobType: 'fact-extraction',
  pollIntervalMs: 500,
  maxConcurrency: 1,
  onJob: handleFactExtractionJob,
  onError: (error, job) => {
    console.error(`${LOG_PREFIX} Job failed:`, error, job?.jobId);
  },
});
