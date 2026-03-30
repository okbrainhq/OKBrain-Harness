import { DbWrapper } from './db-types';

export async function createUpload(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  userId: string,
  filename: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO uploads(id, user_id, filename, created_at)
    VALUES(?, ?, ?, CURRENT_TIMESTAMP)
  `).run(id, userId, filename);
}

export async function getUploadByFilename(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  filename: string
): Promise<{ id: string; user_id: string; filename: string } | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(
    'SELECT * FROM uploads WHERE filename = ?'
  ).get(filename);
  return (result as any) ?? null;
}
