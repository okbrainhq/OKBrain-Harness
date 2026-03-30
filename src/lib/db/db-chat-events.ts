import { v4 as uuid } from 'uuid';
import { DbWrapper, ChatEventKind, ChatEvent } from './db-types';

export async function addChatEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  kind: ChatEventKind,
  content: any
): Promise<ChatEvent> {
  await ensureInitialized();
  const id = `evt_${uuid()}`;
  const contentJson = typeof content === 'string' ? content : JSON.stringify(content);

  // Allocate seq: MAX(seq)+1 for this conversation. Safe because SQLite is single-writer
  // and only one job writes per conversation at a time.
  const seqRow = await dbWrapper.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM chat_events WHERE conversation_id = ?`
  ).get(conversationId) as { next_seq: number };
  const seq = seqRow.next_seq;

  await dbWrapper.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, conversationId, seq, kind, contentJson);

  return {
    id,
    conversation_id: conversationId,
    seq,
    kind,
    content: contentJson,
    created_at: new Date().toISOString(),
  };
}

export async function getChatEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
): Promise<ChatEvent[]> {
  await ensureInitialized();

  return dbWrapper.prepare(`
    SELECT * FROM chat_events
    WHERE conversation_id = ?
    ORDER BY seq ASC
  `).all(conversationId) as Promise<ChatEvent[]>;
}

export async function getChatEventsByKind(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  kind: ChatEventKind,
  afterCreatedAt?: string
): Promise<ChatEvent[]> {
  await ensureInitialized();

  if (afterCreatedAt) {
    return dbWrapper.prepare(`
      SELECT * FROM chat_events
      WHERE conversation_id = ? AND kind = ? AND created_at > ?
      ORDER BY seq ASC
    `).all(conversationId, kind, afterCreatedAt) as Promise<ChatEvent[]>;
  }

  return dbWrapper.prepare(`
    SELECT * FROM chat_events
    WHERE conversation_id = ? AND kind = ?
    ORDER BY seq ASC
  `).all(conversationId, kind) as Promise<ChatEvent[]>;
}

export async function updateChatEventFeedback(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  eventId: string,
  feedback: number | null
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE chat_events SET feedback = ? WHERE id = ?
  `).run(feedback, eventId);
}

export async function deleteChatEventsForConversation(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    DELETE FROM chat_events WHERE conversation_id = ?
  `).run(conversationId);
}

export async function getConversationTextEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<{ seq: number; kind: string; content: string; created_at: string }[]> {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT seq, kind, content, created_at FROM chat_events
    WHERE conversation_id = ? AND kind IN ('user_message', 'assistant_text')
    ORDER BY seq ASC
  `).all(conversationId);
  return results as { seq: number; kind: string; content: string; created_at: string }[];
}

export async function deleteChatEventsAfterSeq(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  afterSeq: number
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    DELETE FROM chat_events WHERE conversation_id = ? AND seq > ?
  `).run(conversationId, afterSeq);
}

export async function searchRecentMessages(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string,
  afterTimestamp: string,
  kinds: string[],
  limit: number = 5
): Promise<{ conversation_id: string; conversation_title: string; kind: string; text: string; created_at: string }[]> {
  await ensureInitialized();

  const words = query.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0 || kinds.length === 0) return [];

  const kindPlaceholders = kinds.map(() => '?').join(', ');
  const extractedText = `json_extract(ce.content, '$.text')`;
  const wordClauses = words.map(() => `${extractedText} LIKE ?`).join(' OR ');
  const wordParams = words.map(w => `%${w}%`);

  const results = await dbWrapper.prepare(`
    SELECT ce.conversation_id, c.title as conversation_title, ce.kind,
           ${extractedText} as text, ce.created_at
    FROM chat_events ce
    JOIN conversations c ON c.id = ce.conversation_id
    WHERE c.user_id = ?
      AND ce.kind IN (${kindPlaceholders})
      AND ce.created_at > ?
      AND (${wordClauses})
    ORDER BY ce.created_at DESC
    LIMIT ?
  `).all(userId, ...kinds, afterTimestamp, ...wordParams, limit);

  return results as { conversation_id: string; conversation_title: string; kind: string; text: string; created_at: string }[];
}
