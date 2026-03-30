import { DbWrapper, FileAttachment } from './db-types';

export async function addFileAttachment(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  messageId: string,
  fileUri: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  uploadedAt: string
): Promise<FileAttachment> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO file_attachments(id, message_id, file_uri, file_name, mime_type, file_size, uploaded_at)
  VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(id, messageId, fileUri, fileName, mimeType, fileSize, uploadedAt);

  return (await getFileAttachment(dbWrapper, ensureInitialized, id))!;
}

export async function getFileAttachment(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<FileAttachment | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT * FROM file_attachments WHERE id = ?").get(id);
  return (result as FileAttachment | undefined) || null;
}

export async function getMessageFileAttachments(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  messageId: string
): Promise<FileAttachment[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
  SELECT * FROM file_attachments WHERE message_id = ? ORDER BY created_at ASC
    `).all(messageId);
  return results as FileAttachment[];
}

export async function getConversationFileAttachments(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  getConversation: (userId: string, conversationId: string) => Promise<any>,
  userId: string,
  conversationId: string
): Promise<FileAttachment[]> {
  await ensureInitialized();
  // Ensure conversation belongs to user
  const conv = await getConversation(userId, conversationId);
  if (!conv) return [];

  const results = await dbWrapper.prepare(`
    SELECT fa.* FROM file_attachments fa
    JOIN messages m ON fa.message_id = m.id
    WHERE m.conversation_id = ?
    ORDER BY fa.created_at ASC
      `).all(conversationId);
  return results as FileAttachment[];
}

export async function deleteFileAttachment(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare("DELETE FROM file_attachments WHERE id = ?").run(id);
}
