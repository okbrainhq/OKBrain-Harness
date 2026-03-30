import { DbWrapper, Document, Conversation } from './db-types';

const SHARED_FOLDER_SUBQUERY = `
  folder_id IN (SELECT id FROM folders WHERE is_shared = 1)
`;

export async function createDocument(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  content: string = '',
  folderId: string | null = null
): Promise<Document> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO documents (id, title, content, folder_id, user_id) VALUES (?, ?, ?, ?, ?)
  `).run(id, title, content, folderId, userId);

  return (await getDocument(dbWrapper, ensureInitialized, userId, id))!;
}

export async function getDocument(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<Document | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT * FROM documents
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).get(id, userId);
  return (result as Document | undefined) || null;
}

export async function getAllDocuments(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<Document[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(
    `
    SELECT * FROM documents
    WHERE user_id = ? OR ${SHARED_FOLDER_SUBQUERY}
    ORDER BY updated_at DESC
    `
  ).all(userId);
  return results as Document[];
}

export async function updateDocumentTitle(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE documents
    SET title = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(title, id, userId);
}

export async function updateDocumentContent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  content: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE documents
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(content, id, userId);
}

export async function updateDocument(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  content: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE documents
    SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(title, content, id, userId);
}

export async function deleteDocument(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function moveDocumentToFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  getFolder: (userId: string, id: string) => Promise<any>,
  userId: string,
  documentId: string,
  folderId: string | null
): Promise<void> {
  await ensureInitialized();
  // Ensure document belongs to user
  const doc = await getDocument(dbWrapper, ensureInitialized, userId, documentId);
  if (!doc) return;

  // If folderId is provided, ensure folder belongs to user
  if (folderId) {
    const folder = await getFolder(userId, folderId);
    if (!folder) return;
  }

  await dbWrapper.prepare(`
    UPDATE documents SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
    `).run(folderId, documentId, userId);
}

export async function getDocumentsByFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  folderId: string | null
): Promise<Document[]> {
  await ensureInitialized();
  if (folderId === null) {
    const results = await dbWrapper.prepare(
      "SELECT * FROM documents WHERE folder_id IS NULL AND user_id = ? ORDER BY updated_at DESC"
    ).all(userId);
    return results as Document[];
  }
  const results = await dbWrapper.prepare(`
    SELECT d.* FROM documents d
    JOIN folders f ON d.folder_id = f.id
    WHERE d.folder_id = ? AND (d.user_id = ? OR f.is_shared = 1)
    ORDER BY d.updated_at DESC
  `).all(folderId, userId);
  return results as Document[];
}

export async function getDocumentConversations(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  documentId: string
): Promise<Conversation[]> {
  await ensureInitialized();
  const document = await getDocument(dbWrapper, ensureInitialized, userId, documentId);
  if (!document) return [];

  const results = await dbWrapper.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_documents cd ON c.id = cd.conversation_id
    WHERE cd.document_id = ?
      AND (c.user_id = ? OR c.folder_id IN (SELECT id FROM folders WHERE is_shared = 1))
    ORDER BY c.updated_at DESC
  `).all(documentId, userId);
  return results as Conversation[];
}

export async function searchDocuments(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string
): Promise<Document[]> {
  await ensureInitialized();
  const searchPattern = `%${query}%`;
  const startsWithPattern = `${query}%`;
  const results = await dbWrapper.prepare(
    `
    SELECT * FROM documents
    WHERE (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
      AND title LIKE ?
    ORDER BY
      CASE WHEN title LIKE ? THEN 0 ELSE 1 END,
      updated_at DESC
    `
  ).all(userId, searchPattern, startsWithPattern);
  return results as Document[];
}
