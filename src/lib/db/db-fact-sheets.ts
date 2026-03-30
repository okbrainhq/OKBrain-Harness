import { DbWrapper, FactSheet } from './db-types';

export async function saveFactSheet(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  userId: string,
  factsJson: string,
  dedupLog: string | null,
  factCount: number,
  source: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, dedup_log, fact_count, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, factsJson, dedupLog, factCount, source);
}

export async function getLatestFactSheet(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<FactSheet | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT id, user_id, facts_json, dedup_log, fact_count, source, created_at
    FROM fact_sheets
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
  return (result as FactSheet) || null;
}

export async function getLatestFactSheetBySource(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  source: string
): Promise<FactSheet | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT id, user_id, facts_json, dedup_log, fact_count, source, created_at
    FROM fact_sheets
    WHERE user_id = ? AND source = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, source);
  return (result as FactSheet) || null;
}

export async function deleteOldFactSheets(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    DELETE FROM fact_sheets
    WHERE user_id = ? AND created_at < datetime('now', '-7 days')
  `).run(userId);
}

export async function getLastFactSheetTimeBySource(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  source: string
): Promise<string | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT created_at
    FROM fact_sheets
    WHERE source = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(source) as { created_at: string } | undefined;
  return result?.created_at || null;
}

export async function updateFactSheetFacts(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  sheetId: string,
  userId: string,
  factsJson: string,
  factCount: number
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE fact_sheets
    SET facts_json = ?, fact_count = ?
    WHERE id = ? AND user_id = ?
  `).run(factsJson, factCount, sheetId, userId);
  return (result as any).changes > 0;
}
