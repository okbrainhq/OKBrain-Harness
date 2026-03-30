import { DbWrapper } from './db-types';

export async function getUserKV(
  db: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  key: string
): Promise<{ value: string; updated_at: string } | null> {
  await ensureInitialized();
  return db
    .prepare('SELECT value, updated_at FROM user_kv_store WHERE user_id = ? AND key = ?')
    .get(userId, key);
}

export async function setUserKV(
  db: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  key: string,
  value: string
): Promise<void> {
  await ensureInitialized();
  const now = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO user_kv_store (user_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(userId, key, value, now);
}

export async function deleteUserKV(
  db: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  key: string
): Promise<void> {
  await ensureInitialized();
  await db
    .prepare('DELETE FROM user_kv_store WHERE user_id = ? AND key = ?')
    .run(userId, key);
}
