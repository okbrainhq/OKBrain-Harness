import { DbWrapper, Folder } from './db-types';

export const SHARED_FOLDER_NAME = 'Shared';
const SHARED_FOLDER_ID = 'global-shared-folder';

export type FolderMutationResult = 'ok' | 'not_found' | 'forbidden';

export async function ensureSharedFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<Folder> {
  await ensureInitialized();

  const existing = await dbWrapper.prepare(`
    SELECT * FROM folders WHERE is_shared = 1 LIMIT 1
  `).get();
  if (existing) return existing as Folder;

  try {
    await dbWrapper.prepare(`
      INSERT INTO folders (id, name, user_id, is_shared)
      VALUES (?, ?, ?, 1)
    `).run(SHARED_FOLDER_ID, SHARED_FOLDER_NAME, userId);
  } catch {
    // Another request may have created it concurrently.
  }

  const created = await dbWrapper.prepare(`
    SELECT * FROM folders WHERE is_shared = 1 LIMIT 1
  `).get();
  if (!created) {
    throw new Error('Failed to ensure shared folder');
  }
  return created as Folder;
}

export async function createFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  name: string
): Promise<Folder> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO folders (id, name, user_id) VALUES (?, ?, ?)
  `).run(id, name, userId);

  return (await getFolder(dbWrapper, ensureInitialized, userId, id))!;
}

export async function getFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<Folder | null> {
  await ensureSharedFolder(dbWrapper, ensureInitialized, userId);
  const result = await dbWrapper.prepare(`
    SELECT * FROM folders
    WHERE id = ? AND (user_id = ? OR is_shared = 1)
  `).get(id, userId);
  return (result as Folder | undefined) || null;
}

export async function getAllFolders(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<Folder[]> {
  await ensureSharedFolder(dbWrapper, ensureInitialized, userId);
  const results = await dbWrapper.prepare(
    `
    SELECT * FROM folders
    WHERE user_id = ? OR is_shared = 1
    ORDER BY is_shared DESC, name ASC
    `
  ).all(userId);
  return results as Folder[];
}

export async function updateFolderName(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  name: string
): Promise<FolderMutationResult> {
  await ensureInitialized();
  const folder = await getFolder(dbWrapper, ensureInitialized, userId, id);
  if (!folder) return 'not_found';
  if (folder.is_shared === 1) return 'forbidden';

  await dbWrapper.prepare(`
    UPDATE folders
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND is_shared = 0
  `).run(name, id, userId);

  return 'ok';
}

export async function deleteFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<FolderMutationResult> {
  await ensureInitialized();

  const folder = await getFolder(dbWrapper, ensureInitialized, userId, id);
  if (!folder) return 'not_found';
  if (folder.is_shared === 1) return 'forbidden';

  // First, unassign all conversations from this folder (that belong to the user)
  await dbWrapper.prepare(`
    UPDATE conversations SET folder_id = NULL WHERE folder_id = ? AND user_id = ?
  `).run(id, userId);
  // Also unassign all documents from this folder (that belong to the user)
  await dbWrapper.prepare(`
    UPDATE documents SET folder_id = NULL WHERE folder_id = ? AND user_id = ?
  `).run(id, userId);
  // Then delete the folder
  await dbWrapper.prepare(`
    DELETE FROM folders WHERE id = ? AND user_id = ? AND is_shared = 0
  `).run(id, userId);

  return 'ok';
}
