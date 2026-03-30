import { DbWrapper, SharedLink } from './db-types';

export async function createSharedLink(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  type: 'conversation' | 'document' | 'snapshot',
  resourceId: string,
  id: string
): Promise<SharedLink> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO shared_links (id, type, resource_id, user_id) VALUES (?, ?, ?, ?)
  `).run(id, type, resourceId, userId);

  return (await getSharedLink(dbWrapper, ensureInitialized, id))!;
}

export async function getSharedLink(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<SharedLink | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT * FROM shared_links WHERE id = ?").get(id);
  return (result as SharedLink | undefined) || null;
}

export async function getSharedLinkByResource(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  type: 'conversation' | 'document' | 'snapshot',
  resourceId: string
): Promise<SharedLink | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT * FROM shared_links WHERE user_id = ? AND type = ? AND resource_id = ?").get(userId, type, resourceId);
  return (result as SharedLink | undefined) || null;
}
