/**
 * Backfill embeddings for existing facts that don't have them yet.
 * Usage: npx tsx scripts/embed-facts.ts
 */

import { getFactsWithoutEmbeddings, saveFactEmbedding } from '../src/lib/db';
import { embedDocumentBatch, isOllamaAvailable, isEmbeddingsEnabled } from '../src/lib/ai/embeddings';

const BATCH_SIZE = 50;
const LOG_PREFIX = '[EmbedFacts]';

async function main() {
  if (!isEmbeddingsEnabled()) {
    console.error(`${LOG_PREFIX} Embeddings not configured. Set OLLAMA_URL and VECTOR_EMBEDDING_MODEL to enable.`);
    process.exit(1);
  }

  if (!(await isOllamaAvailable())) {
    console.error(`${LOG_PREFIX} Ollama is not available. Please start it first.`);
    process.exit(1);
  }

  const facts = await getFactsWithoutEmbeddings();
  if (facts.length === 0) {
    console.log(`${LOG_PREFIX} All facts already have embeddings. Nothing to do.`);
    return;
  }

  console.log(`${LOG_PREFIX} Found ${facts.length} facts without embeddings.`);

  let processed = 0;
  for (let i = 0; i < facts.length; i += BATCH_SIZE) {
    const batch = facts.slice(i, i + BATCH_SIZE);
    const texts = batch.map(f => f.fact);

    const embeddings = await embedDocumentBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      await saveFactEmbedding(batch[j].id, batch[j].user_id, embeddings[j]);
      processed++;
      const preview = batch[j].fact.length > 50
        ? batch[j].fact.slice(0, 50) + '...'
        : batch[j].fact;
      console.log(`${LOG_PREFIX} ${processed}/${facts.length} — "${preview}"`);
    }
  }

  console.log(`${LOG_PREFIX} Done. Embedded ${processed} facts.`);
}

main().catch(err => {
  console.error(`${LOG_PREFIX} Fatal error:`, err);
  process.exit(1);
});
