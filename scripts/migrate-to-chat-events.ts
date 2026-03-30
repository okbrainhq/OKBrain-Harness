/**
 * Migration script: Migrate from messages + tool_call_logs to chat_events
 *
 * Usage: npx tsx scripts/migrate-to-chat-events.ts [db-path]
 *
 * This is an OFFLINE migration. Stop the app before running.
 * It stages all sources (messages + tool_call_logs) into a temp table,
 * assigns seq via ROW_NUMBER, inserts into chat_events, migrates feedback,
 * and drops old tables.
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const dbPath = process.argv[2] || path.join(process.cwd(), 'brain.db');
console.log(`[Migration] Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

try {
  // Step 1: Create chat_events table if not exists
  console.log('[Migration] Step 1: Ensuring chat_events table exists...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      feedback INTEGER CHECK(feedback IN (1, -1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, seq),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_events_conv_seq ON chat_events(conversation_id, seq)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_events_kind ON chat_events(kind)`);

  // Check if there's data to migrate
  const messageCount = (db.prepare(`SELECT COUNT(*) as cnt FROM messages`).get() as any)?.cnt || 0;
  if (messageCount === 0) {
    console.log('[Migration] No messages to migrate. Done.');
    process.exit(0);
  }

  const eventCount = (db.prepare(`SELECT COUNT(*) as cnt FROM chat_events`).get() as any)?.cnt || 0;
  if (eventCount > 0) {
    console.log(`[Migration] chat_events already has ${eventCount} events. Will skip duplicates.`);
  }

  // Step 2: Stage all events into temp table
  console.log('[Migration] Step 2: Staging all events...');
  db.exec(`DROP TABLE IF EXISTS _staged_events`);
  db.exec(`
    CREATE TEMP TABLE _staged_events AS

    -- User messages
    SELECT
      'evt_' || m.id as id,
      m.conversation_id,
      m.created_at,
      0 as priority,
      'user_message' as kind,
      json_object(
        'text', m.content,
        'attachments', COALESCE(
          (SELECT json_group_array(json_object('name', fa.file_name, 'uri', fa.file_uri, 'mime_type', fa.mime_type))
           FROM file_attachments fa WHERE fa.message_id = m.id),
          '[]'
        )
      ) as content
    FROM messages m WHERE m.role = 'user'

    UNION ALL

    -- Assistant thoughts (render before text within same timestamp)
    SELECT
      'evt_' || m.id || '_thought',
      m.conversation_id,
      m.created_at,
      1 as priority,
      'thought',
      json_object(
        'text', m.thoughts,
        'duration', m.thinking_duration,
        'signature', m.thought_signature
      )
    FROM messages m WHERE m.role = 'assistant' AND m.thoughts IS NOT NULL AND m.thoughts != ''

    UNION ALL

    -- Assistant text
    SELECT
      'evt_' || m.id || '_text',
      m.conversation_id,
      m.created_at,
      2 as priority,
      'assistant_text',
      json_object(
        'text', m.content,
        'model', m.model,
        'was_grounded', m.was_grounded
      )
    FROM messages m WHERE m.role = 'assistant' AND m.content IS NOT NULL AND m.content != ''

    UNION ALL

    -- Observer summaries
    SELECT
      'evt_' || m.id || '_summary',
      m.conversation_id,
      m.created_at,
      2 as priority,
      'summary',
      json_object('text', m.content, 'model', m.model)
    FROM messages m WHERE m.role = 'summary'

    UNION ALL

    -- Sources (after text)
    SELECT
      'evt_' || m.id || '_sources',
      m.conversation_id,
      m.created_at,
      3 as priority,
      'sources',
      m.sources
    FROM messages m WHERE m.role = 'assistant' AND m.sources IS NOT NULL AND m.sources != ''

    UNION ALL

    -- Tool calls
    SELECT
      'evt_tcl_' || t.id,
      t.conversation_id,
      COALESCE(t.created_at, t.updated_at),
      4 as priority,
      'tool_call',
      json_object(
        'tool_name', t.tool_name,
        'arguments', json(t.arguments),
        'call_id', t.tool_call_id,
        'async_job_id', t.async_job_id
      )
    FROM tool_call_logs t

    UNION ALL

    -- Tool results (only for completed tools)
    SELECT
      'evt_tcl_' || t.id || '_result',
      t.conversation_id,
      COALESCE(t.completed_at, t.yielded_at, t.updated_at, t.created_at),
      5 as priority,
      'tool_result',
      json_object(
        'call_id', t.tool_call_id,
        'status', CASE
          WHEN t.status = 'succeeded' THEN 'success'
          WHEN t.status = 'failed' THEN 'error'
          WHEN t.status = 'yielded' THEN 'yield'
          ELSE t.status
        END,
        'error', t.error
      )
    FROM tool_call_logs t WHERE t.status IN ('succeeded', 'failed', 'yielded')
  `);

  const stagedCount = (db.prepare(`SELECT COUNT(*) as cnt FROM _staged_events`).get() as any)?.cnt || 0;
  console.log(`[Migration] Staged ${stagedCount} events`);

  // Step 3: Assign seq and insert into chat_events (skip existing events)
  console.log('[Migration] Step 3: Inserting into chat_events with seq...');
  db.exec(`
    INSERT OR IGNORE INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    SELECT
      id,
      conversation_id,
      COALESCE(
        (SELECT MAX(ce.seq) FROM chat_events ce WHERE ce.conversation_id = new_events.conversation_id), 0
      ) + ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at, priority) as seq,
      kind,
      content,
      created_at
    FROM _staged_events new_events
    WHERE id NOT IN (SELECT id FROM chat_events)
  `);

  const insertedCount = (db.prepare(`SELECT COUNT(*) as cnt FROM chat_events`).get() as any)?.cnt || 0;
  console.log(`[Migration] Inserted ${insertedCount} chat events`);

  // Step 4: Migrate feedback (skip if messages.feedback column doesn't exist)
  console.log('[Migration] Step 4: Migrating feedback...');
  try {
    db.exec(`
      UPDATE chat_events
      SET feedback = (
        SELECT m.feedback FROM messages m
        WHERE chat_events.id = 'evt_' || m.id || '_text'
          AND m.feedback IS NOT NULL
      )
      WHERE kind = 'assistant_text'
    `);

    const feedbackCount = (db.prepare(`SELECT COUNT(*) as cnt FROM chat_events WHERE feedback IS NOT NULL`).get() as any)?.cnt || 0;
    console.log(`[Migration] Migrated ${feedbackCount} feedback entries`);
  } catch (e: any) {
    if (e.code === 'SQLITE_ERROR' && e.message.includes('no such column')) {
      console.log('[Migration] Step 4: Skipped (messages table has no feedback column)');
    } else {
      throw e;
    }
  }

  // Step 5: Verify no duplicate seqs
  console.log('[Migration] Step 5: Verifying...');
  const duplicates = db.prepare(`
    SELECT conversation_id, seq, COUNT(*) as cnt
    FROM chat_events
    GROUP BY conversation_id, seq
    HAVING COUNT(*) > 1
  `).all();

  if (duplicates.length > 0) {
    console.error('[Migration] ERROR: Found duplicate seq values!', duplicates);
    console.error('[Migration] Aborting. chat_events table has been populated but old tables are NOT dropped.');
    process.exit(1);
  }
  console.log('[Migration] No duplicate seqs found. Verification passed.');

  // Step 6: Clean up temp table
  db.exec(`DROP TABLE IF EXISTS _staged_events`);

  // Step 7: Drop old tables
  console.log('[Migration] Step 7: Dropping old tables...');
  db.exec(`DROP TABLE IF EXISTS file_attachments`);
  db.exec(`DROP TABLE IF EXISTS tool_call_logs`);
  db.exec(`DROP TABLE IF EXISTS messages`);
  console.log('[Migration] Old tables dropped.');

  // Summary
  const conversationCount = (db.prepare(`SELECT COUNT(DISTINCT conversation_id) as cnt FROM chat_events`).get() as any)?.cnt || 0;
  console.log(`[Migration] Done! Migrated ${insertedCount} events across ${conversationCount} conversations.`);

} catch (error) {
  console.error('[Migration] ERROR:', error);
  process.exit(1);
} finally {
  db.pragma('foreign_keys = ON');
  db.close();
}
