import { DbWrapper, FileBrowser } from './db-types';

const SHARED_FOLDER_SUBQUERY = `
  folder_id IN (SELECT id FROM folders WHERE is_shared = 1)
`;

export async function createFileBrowser(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  folderId: string | null = null
): Promise<FileBrowser> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO file_browsers (id, title, user_id, folder_id) VALUES (?, ?, ?, ?)
  `).run(id, title, userId, folderId);

  return (await getFileBrowser(dbWrapper, ensureInitialized, userId, id))!;
}

export async function getFileBrowser(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<FileBrowser | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT * FROM file_browsers
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).get(id, userId);
  return (result as FileBrowser | undefined) || null;
}

export async function updateFileBrowser(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title?: string,
  currentPath?: string
): Promise<void> {
  await ensureInitialized();
  if (title !== undefined && currentPath !== undefined) {
    await dbWrapper.prepare(`
      UPDATE file_browsers
      SET title = ?, current_path = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
    `).run(title, currentPath, id, userId);
  } else if (title !== undefined) {
    await dbWrapper.prepare(`
      UPDATE file_browsers
      SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
    `).run(title, id, userId);
  } else if (currentPath !== undefined) {
    await dbWrapper.prepare(`
      UPDATE file_browsers
      SET current_path = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
    `).run(currentPath, id, userId);
  }
}

export async function deleteFileBrowser(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare("DELETE FROM file_browsers WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function moveFileBrowserToFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  getFolder: (userId: string, id: string) => Promise<any>,
  userId: string,
  fileBrowserId: string,
  folderId: string | null
): Promise<void> {
  await ensureInitialized();
  const fb = await getFileBrowser(dbWrapper, ensureInitialized, userId, fileBrowserId);
  if (!fb) return;

  if (folderId) {
    const folder = await getFolder(userId, folderId);
    if (!folder) return;
  }

  await dbWrapper.prepare(`
    UPDATE file_browsers SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
  `).run(folderId, fileBrowserId, userId);
}

export async function searchFileBrowsers(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string
): Promise<FileBrowser[]> {
  await ensureInitialized();
  const searchPattern = `%${query}%`;
  const startsWithPattern = `${query}%`;
  const results = await dbWrapper.prepare(
    `
    SELECT * FROM file_browsers
    WHERE (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
      AND title LIKE ?
    ORDER BY
      CASE WHEN title LIKE ? THEN 0 ELSE 1 END,
      updated_at DESC
    `
  ).all(userId, searchPattern, startsWithPattern);
  return results as FileBrowser[];
}
