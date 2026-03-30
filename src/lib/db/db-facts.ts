import { DbWrapper, Fact } from './db-types';

export async function getUserFacts(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<Fact[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT f.id, f.user_id, f.category, f.fact, f.created_at,
           COUNT(fe.id) as extraction_count
    FROM facts f
    LEFT JOIN fact_extractions fe ON fe.fact_id = f.id
    WHERE f.user_id = ?
    GROUP BY f.id
    ORDER BY COALESCE(MAX(fe.created_at), f.created_at) DESC
  `).all(userId);
  return results as Fact[];
}

export async function getRecentFacts(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  limit: number = 30
): Promise<Fact[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT f.id, f.user_id, f.category, f.fact, f.created_at,
           COUNT(fe.id) as extraction_count
    FROM facts f
    LEFT JOIN fact_extractions fe ON fe.fact_id = f.id
    WHERE f.user_id = ?
    GROUP BY f.id
    ORDER BY f.created_at DESC
    LIMIT ?
  `).all(userId, limit);
  return results as Fact[];
}

export async function addFact(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  category: string,
  fact: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO facts (id, user_id, category, fact)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, category, fact);
}

export async function deleteFact(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  factId: string
): Promise<void> {
  await ensureInitialized();
  // Delete associated extractions first, then the fact itself
  await dbWrapper.prepare(`
    DELETE FROM fact_extractions WHERE fact_id = ?
  `).run(factId);
  await dbWrapper.prepare(`
    DELETE FROM facts WHERE id = ? AND user_id = ?
  `).run(factId, userId);
}

export async function updateFact(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  factId: string,
  category: string,
  fact: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE facts SET category = ?, fact = ? WHERE id = ? AND user_id = ?
  `).run(category, fact, factId, userId);
}

export async function addFactExtraction(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  factId: string,
  conversationId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO fact_extractions (id, fact_id, conversation_id)
    VALUES (?, ?, ?)
  `).run(id, factId, conversationId);
}

export async function updateConversationFactExtractedAt(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET last_fact_extracted_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(conversationId);
}

export async function getRecentFactsByHours(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  hours: number = 6
): Promise<Fact[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT f.id, f.user_id, f.category, f.fact, f.created_at,
           COUNT(fe.id) as extraction_count
    FROM facts f
    LEFT JOIN fact_extractions fe ON fe.fact_id = f.id
    WHERE f.user_id = ? AND f.created_at > datetime('now', '-' || ? || ' hours')
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `).all(userId, hours);
  return results as Fact[];
}

export async function getUserIdsWithFacts(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
): Promise<string[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT DISTINCT user_id FROM facts
  `).all();
  return (results as { user_id: string }[]).map(r => r.user_id);
}

export async function searchFactsByKeyword(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string,
  category?: string,
  limit: number = 10
): Promise<{ fact: string; category: string; created_at: string }[]> {
  await ensureInitialized();

  const words = query.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  const exactPattern = `%${query}%`;
  const exactBoundary = `% ${query} %`;
  const wordClauses = words.map(() => `fact LIKE ?`).join(' OR ');
  const wordBoundary = words.map(() => `(' ' || fact || ' ') LIKE ?`).join(' OR ');
  const wordParams = words.map(w => `%${w}%`);
  const wordBoundaryParams = words.map(w => `% ${w} %`);
  const categoryClause = category ? 'AND category = ?' : '';
  const categoryParams = category ? [category] : [];

  // Priority: whole-word exact (0) > substring exact (1) > whole-word any (2) > substring any (3)
  const results = await dbWrapper.prepare(`
    SELECT fact, category, created_at FROM facts
    WHERE user_id = ? AND (fact LIKE ? OR ${wordClauses}) ${categoryClause}
    ORDER BY CASE
      WHEN (' ' || fact || ' ') LIKE ? THEN 0
      WHEN fact LIKE ? THEN 1
      WHEN (${wordBoundary}) THEN 2
      ELSE 3
    END, created_at DESC
    LIMIT ?
  `).all(userId, exactPattern, ...wordParams, ...categoryParams, exactBoundary, exactPattern, ...wordBoundaryParams, limit);
  return results as { fact: string; category: string; created_at: string }[];
}

export async function getConversationsForFactExtraction(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
): Promise<{ id: string; user_id: string; last_fact_extracted_at: string | null }[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT c.id, c.user_id, c.last_fact_extracted_at
    FROM conversations c
    WHERE EXISTS (
      SELECT 1 FROM chat_events ce
      WHERE ce.conversation_id = c.id
        AND ce.created_at > datetime('now', '-2 days')
        AND (c.last_fact_extracted_at IS NULL OR ce.created_at > c.last_fact_extracted_at)
    )
    ORDER BY c.updated_at ASC
  `).all();
  return results as { id: string; user_id: string; last_fact_extracted_at: string | null }[];
}
