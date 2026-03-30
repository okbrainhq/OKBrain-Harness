import { DbWrapper } from './db-types';
import { isEmbeddingsEnabled } from '../ai/embeddings';

export async function saveFactEmbedding(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  factId: string,
  userId: string,
  embedding: Float32Array
): Promise<void> {
  if (!isEmbeddingsEnabled()) {
    return; // Skip silently when embeddings disabled
  }
  await ensureInitialized();
  // Upsert: delete then insert in sequence for atomicity
  await dbWrapper.prepare(`DELETE FROM fact_vec WHERE fact_id = ?`).run(factId);
  await dbWrapper.prepare(
    `INSERT INTO fact_vec (fact_id, user_id, embedding) VALUES (?, ?, ?)`
  ).run(factId, userId, embedding);
}

export async function deleteFactEmbedding(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  factId: string
): Promise<void> {
  if (!isEmbeddingsEnabled()) {
    return; // Skip silently when embeddings disabled
  }
  await ensureInitialized();
  await dbWrapper.prepare(`DELETE FROM fact_vec WHERE fact_id = ?`).run(factId);
}

export async function searchFactsByEmbedding(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  queryEmbedding: Float32Array,
  limit: number = 10,
  maxDistance: number = 1.0
): Promise<Array<{ id: string; fact: string; category: string; last_extracted_at: string | null; distance: number }>> {
  if (!isEmbeddingsEnabled()) {
    throw new Error('Semantic search not enabled. Set OLLAMA_URL and VECTOR_EMBEDDING_MODEL to enable.');
  }
  await ensureInitialized();

  // KNN search via sqlite-vec
  const vecResults = await dbWrapper.prepare(`
    SELECT fv.fact_id, fv.distance
    FROM fact_vec fv
    WHERE fv.embedding MATCH ? AND fv.user_id = ?
    ORDER BY fv.distance
    LIMIT ?
  `).all(queryEmbedding, userId, limit) as Array<{ fact_id: string; distance: number }>;

  if (vecResults.length === 0) return [];

  // Filter by max distance
  const filtered = vecResults.filter(r => r.distance <= maxDistance);
  if (filtered.length === 0) return [];

  // Join with facts + fact_extractions to get full details
  const placeholders = filtered.map(() => '?').join(',');
  const factIds = filtered.map(r => r.fact_id);

  const facts = await dbWrapper.prepare(`
    SELECT f.id, f.fact, f.category,
           MAX(fe.created_at) as last_extracted_at
    FROM facts f
    LEFT JOIN fact_extractions fe ON fe.fact_id = f.id
    WHERE f.id IN (${placeholders})
    GROUP BY f.id
  `).all(...factIds) as Array<{ id: string; fact: string; category: string; last_extracted_at: string | null }>;

  // Build a map for fast lookup
  const factMap = new Map(facts.map(f => [f.id, f]));
  const distanceMap = new Map(filtered.map(r => [r.fact_id, r.distance]));

  // Return in distance order
  return filtered
    .map(r => {
      const fact = factMap.get(r.fact_id);
      if (!fact) return null;
      return { ...fact, distance: distanceMap.get(r.fact_id)! };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
}

export async function getFactsWithoutEmbeddings(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId?: string
): Promise<Array<{ id: string; user_id: string; fact: string }>> {
  if (!isEmbeddingsEnabled()) {
    return []; // Return empty when embeddings disabled
  }
  await ensureInitialized();

  const sql = userId
    ? `SELECT f.id, f.user_id, f.fact FROM facts f LEFT JOIN fact_vec fv ON fv.fact_id = f.id WHERE fv.fact_id IS NULL AND f.user_id = ?`
    : `SELECT f.id, f.user_id, f.fact FROM facts f LEFT JOIN fact_vec fv ON fv.fact_id = f.id WHERE fv.fact_id IS NULL`;

  const params = userId ? [userId] : [];
  return await dbWrapper.prepare(sql).all(...params) as Array<{ id: string; user_id: string; fact: string }>;
}
