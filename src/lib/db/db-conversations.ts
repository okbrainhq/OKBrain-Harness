import { DbWrapper, Conversation, Message, ResponseMode, Document, SidebarItem } from './db-types';

const SHARED_FOLDER_SUBQUERY = `
  folder_id IN (SELECT id FROM folders WHERE is_shared = 1)
`;

export async function createConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  groundingEnabled: boolean = false,
  responseMode: ResponseMode = 'detailed',
  folderId: string | null = null,
  aiProvider: string = 'gemini',
  documentIds: string[] = [],
  appId: string | null = null
): Promise<Conversation> {
  await ensureInitialized();

  await dbWrapper.prepare(`
    INSERT INTO conversations (id, title, grounding_enabled, response_mode, folder_id, ai_provider, user_id, app_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, groundingEnabled ? 1 : 0, responseMode, folderId, aiProvider, userId, appId);

  // Link multiple documents
  for (const docId of documentIds) {
    await dbWrapper.prepare(`
      INSERT OR IGNORE INTO conversation_documents (conversation_id, document_id) VALUES (?, ?)
    `).run(id, docId);
  }

  return (await getConversation(dbWrapper, ensureInitialized, userId, id))!;
}

export async function updateConversationGrounding(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  groundingEnabled: boolean
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET grounding_enabled = ?
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(groundingEnabled ? 1 : 0, id, userId);
}

export async function updateConversationResponseMode(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  responseMode: ResponseMode
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET response_mode = ?
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(responseMode, id, userId);
}

export async function updateConversationAIProvider(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  aiProvider: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET ai_provider = ?
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(aiProvider, id, userId);
}

export async function getConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<Conversation | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT * FROM conversations
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).get(id, userId);
  if (!result) return null;

  const conversation = result as Conversation;

  // Fetch linked document IDs
  const docResults = await dbWrapper.prepare(`
    SELECT document_id FROM conversation_documents WHERE conversation_id = ?
  `).all(id);
  conversation.document_ids = docResults.map((dr: any) => dr.document_id);

  return conversation;
}

export async function getConversationDocuments(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  conversationId: string
): Promise<Document[]> {
  await ensureInitialized();
  // Ensure conversation belongs to user
  const conv = await getConversation(dbWrapper, ensureInitialized, userId, conversationId);
  if (!conv) return [];

  const results = await dbWrapper.prepare(`
    SELECT d.* FROM documents d
    JOIN conversation_documents cd ON d.id = cd.document_id
    WHERE cd.conversation_id = ?
      AND (d.user_id = ? OR d.folder_id IN (SELECT id FROM folders WHERE is_shared = 1))
  `).all(conversationId, userId);
  return results as Document[];
}

export async function getAllConversations(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<Conversation[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(
    `
    SELECT * FROM conversations
    WHERE user_id = ? OR ${SHARED_FOLDER_SUBQUERY}
    ORDER BY updated_at DESC
    `
  ).all(userId);
  return results as Conversation[];
}

export async function updateConversationTitle(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET title = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(title, id, userId);
}

export async function updateConversationTimestamp(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(id, userId);
}

export async function setConversationActiveJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  jobId: string | null
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET active_job_id = ?
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(jobId, id, userId);
}

export async function trySetConversationActiveJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  conversationId: string,
  jobId: string
): Promise<boolean> {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    UPDATE conversations
    SET active_job_id = ?
    WHERE id = ? AND active_job_id IS NULL
      AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).run(jobId, conversationId, userId);
  return result.changes > 0;
}

export async function setConversationLoopState(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  loopState: string | null,
  loopJobInput: string | null
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations
    SET loop_state = ?, loop_job_input = ?
    WHERE id = ?
  `).run(loopState, loopJobInput, conversationId);
}

export async function getConversationsWithLoopState(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  loopState: string
): Promise<Array<{ id: string; user_id: string; loop_job_input: string }>> {
  await ensureInitialized();
  return dbWrapper.prepare(`
    SELECT id, user_id, loop_job_input
    FROM conversations
    WHERE loop_state = ?
  `).all(loopState) as any;
}

export async function deleteConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function moveConversationToFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  getFolder: (userId: string, id: string) => Promise<any>,
  userId: string,
  conversationId: string,
  folderId: string | null
): Promise<void> {
  await ensureInitialized();
  // Ensure conversation belongs to user
  const conv = await getConversation(dbWrapper, ensureInitialized, userId, conversationId);
  if (!conv) return;

  // If folderId is provided, ensure folder belongs to user
  if (folderId) {
    const folder = await getFolder(userId, folderId);
    if (!folder) return;
  }

  await dbWrapper.prepare(`
    UPDATE conversations SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
  `).run(folderId, conversationId, userId);
}

export async function getConversationsByFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  folderId: string | null
): Promise<Conversation[]> {
  await ensureInitialized();
  if (folderId === null) {
    const results = await dbWrapper.prepare(
      "SELECT * FROM conversations WHERE folder_id IS NULL AND user_id = ? ORDER BY updated_at DESC"
    ).all(userId);
    return results as Conversation[];
  }
  const results = await dbWrapper.prepare(`
    SELECT c.* FROM conversations c
    JOIN folders f ON c.folder_id = f.id
    WHERE c.folder_id = ? AND (c.user_id = ? OR f.is_shared = 1)
    ORDER BY c.updated_at DESC
  `).all(folderId, userId);
  return results as Conversation[];
}

// Message operations

export async function addMessage(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  conversationId: string,
  role: "user" | "assistant" | "summary",
  content: string,
  model?: string,
  sources?: string,
  wasGrounded: boolean = false,
  thoughts?: string,
  thoughtSignature?: string,
  thinkingDuration?: number
): Promise<Message> {
  await ensureInitialized();
  // Check if conversation belongs to user
  const conv = await getConversation(dbWrapper, ensureInitialized, userId, conversationId);
  if (!conv) throw new Error("Conversation not found or unauthorized");

  await dbWrapper.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, model, sources, was_grounded, thoughts, thought_signature, thinking_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, conversationId, role, content, model || null, sources || null, wasGrounded ? 1 : 0, thoughts || null, thoughtSignature || null, thinkingDuration || null);

  // Update conversation timestamp
  await updateConversationTimestamp(dbWrapper, ensureInitialized, userId, conversationId);

  return (await getMessage(dbWrapper, ensureInitialized, id))!;
}

export async function getMessage(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string
): Promise<Message | null> {
  await ensureInitialized();
  const result = await dbWrapper.prepare("SELECT * FROM messages WHERE id = ?").get(id);
  return (result as Message | undefined) || null;
}

export async function updateMessageFeedback(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  feedback: number | null
): Promise<void> {
  await ensureInitialized();

  // Verify message belongs to user
  const message = await getMessage(dbWrapper, ensureInitialized, id);
  if (!message) throw new Error("Message not found");

  const conv = await getConversation(dbWrapper, ensureInitialized, userId, message.conversation_id);
  if (!conv) throw new Error("Unauthorized to update message feedback");

  await dbWrapper.prepare(`
    UPDATE messages SET feedback = ? WHERE id = ?
  `).run(feedback, id);
}

export async function deleteMessage(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<void> {
  await ensureInitialized();
  // Check if message belongs to user's conversation
  const message = await getMessage(dbWrapper, ensureInitialized, id);
  if (!message) return;
  const conv = await getConversation(dbWrapper, ensureInitialized, userId, message.conversation_id);
  if (!conv) throw new Error("Unauthorized to delete message");

  await dbWrapper.prepare("DELETE FROM messages WHERE id = ?").run(id);
}

export async function deleteConversationMessages(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  conversationId: string
): Promise<void> {
  await ensureInitialized();
  const conv = await getConversation(dbWrapper, ensureInitialized, userId, conversationId);
  if (!conv) throw new Error("Conversation not found or unauthorized");

  await dbWrapper.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
}

export async function getConversationMessages(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  conversationId: string
): Promise<Message[]> {
  await ensureInitialized();
  // Check if conversation belongs to user
  const conv = await getConversation(dbWrapper, ensureInitialized, userId, conversationId);
  if (!conv) return [];

  const results = await dbWrapper.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(conversationId);
  return results as Message[];
}

export async function getSidebarItems(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  type: 'uncategorized' | 'folder',
  folderId: string | null = null,
  limit: number = 50,
  offset: number = 0
): Promise<SidebarItem[]> {
  await ensureInitialized();

  let query = "";
  let params: any[] = [];

  if (type === 'uncategorized') {
    query = `
      SELECT
        c.id,
        c.title,
        c.folder_id,
        c.updated_at,
        'chat' as type,
        c.active_job_id AS active_job_id,
        CASE
          WHEN c.active_job_id IS NOT NULL OR EXISTS (
            SELECT 1
            FROM chat_yield_sessions ys
            WHERE ys.conversation_id = c.id
              AND ys.state IN ('waiting', 'resume_queued')
          ) THEN 1
          ELSE 0
        END AS is_running,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM chat_yield_sessions ys
            WHERE ys.conversation_id = c.id
              AND ys.state IN ('waiting', 'resume_queued')
          ) THEN 1
          ELSE 0
        END AS is_yielding
      FROM conversations c
      WHERE c.user_id = ? AND c.folder_id IS NULL
      UNION ALL
      SELECT id, title, folder_id, updated_at, 'document' as type, NULL AS active_job_id, 0 AS is_running, 0 AS is_yielding
      FROM documents
      WHERE user_id = ? AND folder_id IS NULL
      UNION ALL
      SELECT id, title, folder_id, updated_at, 'filebrowser' as type, NULL AS active_job_id, 0 AS is_running, 0 AS is_yielding
      FROM file_browsers
      WHERE user_id = ? AND folder_id IS NULL
      UNION ALL
      SELECT id, title, folder_id, updated_at, 'app' as type, NULL AS active_job_id, 0 AS is_running, 0 AS is_yielding
      FROM apps
      WHERE user_id = ? AND folder_id IS NULL
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;
    params = [userId, userId, userId, userId, limit, offset];
  } else {
    query = `
      SELECT * FROM (
        SELECT
          c.id,
          c.title,
          c.folder_id,
          c.updated_at AS updated_at,
          'chat' as type,
          c.active_job_id AS active_job_id,
          CASE
            WHEN c.active_job_id IS NOT NULL OR EXISTS (
              SELECT 1
              FROM chat_yield_sessions ys
              WHERE ys.conversation_id = c.id
                AND ys.state IN ('waiting', 'resume_queued')
            ) THEN 1
            ELSE 0
          END AS is_running,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM chat_yield_sessions ys
              WHERE ys.conversation_id = c.id
                AND ys.state IN ('waiting', 'resume_queued')
            ) THEN 1
            ELSE 0
          END AS is_yielding
        FROM conversations c
        JOIN folders f ON c.folder_id = f.id
        WHERE c.folder_id = ? AND (c.user_id = ? OR f.is_shared = 1)
        UNION ALL
        SELECT d.id, d.title, d.folder_id, d.updated_at AS updated_at, 'document' as type, NULL AS active_job_id, 0 AS is_running, 0 AS is_yielding
        FROM documents d
        JOIN folders f ON d.folder_id = f.id
        WHERE d.folder_id = ? AND (d.user_id = ? OR f.is_shared = 1)
        UNION ALL
        SELECT fb.id, fb.title, fb.folder_id, fb.updated_at AS updated_at, 'filebrowser' as type, NULL AS active_job_id, 0 AS is_running, 0 AS is_yielding
        FROM file_browsers fb
        JOIN folders f ON fb.folder_id = f.id
        WHERE fb.folder_id = ? AND (fb.user_id = ? OR f.is_shared = 1)
        UNION ALL
        SELECT a.id, a.title, a.folder_id, a.updated_at AS updated_at, 'app' as type, NULL AS active_job_id, 0 AS is_running, 0 AS is_yielding
        FROM apps a
        JOIN folders f ON a.folder_id = f.id
        WHERE a.folder_id = ? AND (a.user_id = ? OR f.is_shared = 1)
      )
      ORDER BY updated_at DESC
    `;
    params = [folderId, userId, folderId, userId, folderId, userId, folderId, userId];
  }

  const results = await dbWrapper.prepare(query).all(...params);
  return results as SidebarItem[];
}

export async function getConversationsByAppId(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  appId: string
): Promise<Conversation[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT * FROM conversations WHERE user_id = ? AND app_id = ? ORDER BY updated_at DESC
  `).all(userId, appId);
  return results as Conversation[];
}

export async function getRecentConversationsWithUserMessages(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  excludeConversationId: string,
  sinceDate?: string,
  limit: number = 5
): Promise<Array<{ id: string; title: string; userMessages: string[] }>> {
  await ensureInitialized();

  let conversations: Array<{ id: string; title: string }>;
  if (sinceDate) {
    conversations = await dbWrapper.prepare(`
      SELECT id, title FROM conversations
      WHERE user_id = ? AND id != ? AND updated_at > ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(userId, excludeConversationId, sinceDate, limit) as any;
  } else {
    conversations = await dbWrapper.prepare(`
      SELECT id, title FROM conversations
      WHERE user_id = ? AND id != ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(userId, excludeConversationId, limit) as any;
  }

  const result: Array<{ id: string; title: string; userMessages: string[] }> = [];

  for (const conv of conversations) {
    // Try chat_events first, fallback to messages table
    let userMessageTexts: string[] = [];

    try {
      const events = await dbWrapper.prepare(`
        SELECT content FROM chat_events
        WHERE conversation_id = ? AND kind = 'user_message'
        ORDER BY seq DESC
        LIMIT 5
      `).all(conv.id) as Array<{ content: string }>;

      if (events.length > 0) {
        userMessageTexts = events.map(e => {
          try {
            const parsed = JSON.parse(e.content);
            return parsed.text || '';
          } catch {
            return '';
          }
        }).filter(t => t.length > 0);
      }
    } catch {
      // chat_events table may not exist yet during migration
    }

    // Fallback to old messages table
    if (userMessageTexts.length === 0) {
      const messages = await dbWrapper.prepare(`
        SELECT content FROM messages
        WHERE conversation_id = ? AND role = 'user'
        ORDER BY created_at DESC
        LIMIT 5
      `).all(conv.id) as Array<{ content: string }>;

      userMessageTexts = messages.map(m => m.content);
    }

    if (userMessageTexts.length === 0) continue;

    result.push({
      id: conv.id,
      title: conv.title || 'Untitled',
      userMessages: userMessageTexts.map(t =>
        t.length > 500 ? t.slice(0, 500) + '...' : t
      ),
    });
  }

  return result;
}

export async function setConversationSourceSharedLink(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  sharedLinkId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversations SET source_shared_link_id = ? WHERE id = ?
  `).run(sharedLinkId, conversationId);
}

export async function searchConversations(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string
): Promise<Conversation[]> {
  await ensureInitialized();

  const words = query.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  const exactPattern = `%${query}%`;
  // Word boundary patterns: pad with spaces so "NAS" matches " NAS " but not "Rathanasiri"
  const exactBoundary = `% ${query} %`;
  const titleWordLikes = words.map(() => `c.title LIKE ?`).join(' OR ');
  const titleWordBoundary = words.map(() => `(' ' || c.title || ' ') LIKE ?`).join(' OR ');
  const factWordLikes = words.map(() => `f.fact LIKE ?`).join(' OR ');
  const titleWordParams = words.map(w => `%${w}%`);
  const titleWordBoundaryParams = words.map(w => `% ${w} %`);
  const factWordParams = words.map(w => `%${w}%`);

  // Priority: whole-word title (0) > substring title (1) > whole-word any word (2) > substring any word (3) > fact (4)
  const results = await dbWrapper.prepare(
    `
    SELECT * FROM conversations c
    WHERE (c.user_id = ? OR c.${SHARED_FOLDER_SUBQUERY})
      AND (
        c.title LIKE ?
        OR (${titleWordLikes})
        OR EXISTS (
          SELECT 1 FROM fact_extractions fe
          JOIN facts f ON f.id = fe.fact_id
          WHERE fe.conversation_id = c.id AND (f.fact LIKE ? OR ${factWordLikes})
        )
      )
    ORDER BY
      CASE
        WHEN (' ' || c.title || ' ') LIKE ? THEN 0
        WHEN c.title LIKE ? THEN 1
        WHEN (${titleWordBoundary}) THEN 2
        WHEN (${titleWordLikes}) THEN 3
        ELSE 4
      END,
      c.updated_at DESC
    `
  ).all(
    userId,
    exactPattern, ...titleWordParams, exactPattern, ...factWordParams,
    exactBoundary, exactPattern, ...titleWordBoundaryParams, ...titleWordParams
  );
  return results as Conversation[];
}

export async function searchRecentConversationsByMessages(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string,
  afterTimestamp: string
): Promise<Conversation[]> {
  await ensureInitialized();

  const words = query.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  const extractedText = `json_extract(ce.content, '$.text')`;
  const wordClauses = words.map(() => `${extractedText} LIKE ?`).join(' OR ');
  const wordParams = words.map(w => `%${w}%`);

  const results = await dbWrapper.prepare(`
    SELECT DISTINCT c.* FROM conversations c
    JOIN chat_events ce ON ce.conversation_id = c.id
    WHERE c.user_id = ?
      AND ce.kind IN ('user_message', 'assistant_text')
      AND ce.created_at > ?
      AND (${wordClauses})
    ORDER BY c.updated_at DESC
  `).all(userId, afterTimestamp, ...wordParams);

  return results as Conversation[];
}
