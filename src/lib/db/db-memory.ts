import { DbWrapper, UserMemory } from './db-types';

export async function getUserMemory(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<UserMemory | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT * FROM user_memory WHERE user_id = ?").get(userId);
  return (result as UserMemory | undefined) || null;
}

export async function updateUserMemory(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  memoryText: string
): Promise<void> {
  await ensureInitialized();

  // Check if memory exists
  const existing = await getUserMemory(dbWrapper, ensureInitialized, userId);

  if (existing) {
    await dbWrapper.prepare(`
      UPDATE user_memory
      SET memory_text = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(memoryText, userId);
  } else {
    await dbWrapper.prepare(`
      INSERT INTO user_memory(user_id, memory_text)
      VALUES(?, ?)
    `).run(userId, memoryText);
  }
}
