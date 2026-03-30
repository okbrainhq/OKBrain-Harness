import { DbWrapper } from './db-types';

// Initialize database schema
export async function initializeSchema(dbWrapper: DbWrapper) {
  // Create users table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create folders table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      is_shared INTEGER NOT NULL DEFAULT 0 CHECK(is_shared IN (0, 1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create conversations table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      folder_id TEXT,
      user_id TEXT NOT NULL,
      grounding_enabled INTEGER DEFAULT 0,
      document_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
    )
  `);

  // Create documents table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      folder_id TEXT,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create document_snapshots table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS document_snapshots (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create index for document snapshots
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_document_snapshots_document
    ON document_snapshots(document_id, created_at DESC)
  `);

  // Create user_memory table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT PRIMARY KEY,
      memory_text TEXT NOT NULL DEFAULT '',
      last_scanned_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create events table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      start_datetime DATETIME NOT NULL,
      end_datetime DATETIME,
      recurrence_type TEXT CHECK(recurrence_type IN ('weekly', 'monthly')) DEFAULT NULL,
      recurrence_end_date DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add recurrence columns if they don't exist
  try {
    const tableInfo = await dbWrapper.prepare(`PRAGMA table_info(events)`).all();
    const columns = tableInfo.map((col: any) => col.name);

    if (!columns.includes('recurrence_type')) {
      console.log('[DB] Adding recurrence_type column to events table...');
      await dbWrapper.exec(`ALTER TABLE events ADD COLUMN recurrence_type TEXT CHECK(recurrence_type IN ('weekly', 'monthly')) DEFAULT NULL`);
    }

    if (!columns.includes('recurrence_end_date')) {
      console.log('[DB] Adding recurrence_end_date column to events table...');
      await dbWrapper.exec(`ALTER TABLE events ADD COLUMN recurrence_end_date DATETIME DEFAULT NULL`);
    }
  } catch (error) {
    console.error('[DB] Error during events recurrence migration:', error);
  }

  // Create index for date-based event queries (important for performance)
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_user_datetime
    ON events(user_id, start_datetime)
  `);

  // Create full-text search virtual table for events
  // SQLite FTS5 for efficient full-text search on title, location, and description
  await dbWrapper.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      title,
      location,
      description,
      content='events',
      content_rowid='rowid'
    )
  `);

  // Create triggers to keep FTS table in sync with events table
  await dbWrapper.exec(`
    CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, title, location, description)
      VALUES (new.rowid, new.title, new.location, new.description);
    END;
  `);

  await dbWrapper.exec(`
    CREATE TRIGGER IF NOT EXISTS events_fts_update AFTER UPDATE ON events BEGIN
      UPDATE events_fts SET title = new.title, location = new.location, description = new.description
      WHERE rowid = new.rowid;
    END;
  `);

  await dbWrapper.exec(`
    CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
      DELETE FROM events_fts WHERE rowid = old.rowid;
    END;
  `);

  // Migration: Fix old FTS table schema if it exists with event_id column
  try {
    const ftsTableInfo = await dbWrapper.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='events_fts'`).get();
    if (ftsTableInfo && ftsTableInfo.sql && ftsTableInfo.sql.includes('event_id')) {
      console.log('[DB] Migrating events_fts table to remove event_id column...');

      // Drop old FTS table and triggers
      await dbWrapper.exec(`DROP TABLE IF EXISTS events_fts`);
      await dbWrapper.exec(`DROP TRIGGER IF EXISTS events_fts_insert`);
      await dbWrapper.exec(`DROP TRIGGER IF EXISTS events_fts_update`);
      await dbWrapper.exec(`DROP TRIGGER IF EXISTS events_fts_delete`);

      // Recreate with correct schema
      await dbWrapper.exec(`
        CREATE VIRTUAL TABLE events_fts USING fts5(
          title,
          location,
          description,
          content='events',
          content_rowid='rowid'
        )
      `);

      // Recreate triggers
      await dbWrapper.exec(`
        CREATE TRIGGER events_fts_insert AFTER INSERT ON events BEGIN
          INSERT INTO events_fts(rowid, title, location, description)
          VALUES (new.rowid, new.title, new.location, new.description);
        END;
      `);

      await dbWrapper.exec(`
        CREATE TRIGGER events_fts_update AFTER UPDATE ON events BEGIN
          UPDATE events_fts SET title = new.title, location = new.location, description = new.description
          WHERE rowid = new.rowid;
        END;
      `);

      await dbWrapper.exec(`
        CREATE TRIGGER events_fts_delete AFTER DELETE ON events BEGIN
          DELETE FROM events_fts WHERE rowid = old.rowid;
        END;
      `);

      // Populate FTS from existing events
      await dbWrapper.exec(`
        INSERT INTO events_fts(rowid, title, location, description)
        SELECT rowid, title, location, description FROM events
      `);

      console.log('[DB] Events FTS table migration complete.');
    }
  } catch (error: any) {
    console.warn('Error migrating events_fts table:', error);
  }

  // Update users table if necessary (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(users)`).all();
    const hasPassword = columns.some((col: any) => col.name === 'password');
    const hasPasswordHash = columns.some((col: any) => col.name === 'password_hash');

    if (hasPasswordHash && !hasPassword) {
      await dbWrapper.exec(`ALTER TABLE users RENAME COLUMN password_hash TO password`);
    }

    const hasUpdatedAt = columns.some((col: any) => col.name === 'updated_at');
    if (!hasUpdatedAt) {
      await dbWrapper.exec(`ALTER TABLE users ADD COLUMN updated_at DATETIME`);
      await dbWrapper.exec(`UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL`);
    }
  } catch (error: any) {
    console.warn('Error migrating users table:', error);
  }

  // Add user_id column if it doesn't exist (migration)
  try {
    const tableInfos = [
      { name: 'folders' },
      { name: 'conversations' },
      { name: 'documents' }
    ];

    for (const info of tableInfos) {
      const columns = await dbWrapper.prepare(`PRAGMA table_info(${info.name})`).all();
      const hasUserId = columns.some((col: any) => col.name === 'user_id');
      if (!hasUserId) {
        await dbWrapper.exec(`ALTER TABLE ${info.name} ADD COLUMN user_id TEXT`);
      }
    }
  } catch (error: any) {
    console.warn('Error checking/adding user_id columns:', error);
  }

  // Add is_shared column to folders if it doesn't exist (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(folders)`).all();
    const hasIsShared = columns.some((col: any) => col.name === 'is_shared');
    if (!hasIsShared) {
      await dbWrapper.exec(`ALTER TABLE folders ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0 CHECK(is_shared IN (0, 1))`);
    }
  } catch (error: any) {
    console.warn('Error checking/adding is_shared column:', error);
  }

  // Ensure at most one shared folder row exists before creating the unique partial index
  try {
    const sharedFolders = await dbWrapper.prepare(`
      SELECT id FROM folders WHERE is_shared = 1 ORDER BY created_at ASC, id ASC
    `).all();

    if (sharedFolders.length > 1) {
      const extraIds = sharedFolders.slice(1).map((folder: any) => folder.id);
      for (const folderId of extraIds) {
        await dbWrapper.prepare(`UPDATE folders SET is_shared = 0 WHERE id = ?`).run(folderId);
      }
    }
  } catch (error: any) {
    console.warn('Error normalizing shared folders:', error);
  }

  await dbWrapper.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_single_shared
    ON folders(is_shared) WHERE is_shared = 1
  `);

  // Add response_mode column if it doesn't exist (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasResponseMode = columns.some((col: any) => col.name === 'response_mode');
    if (!hasResponseMode) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN response_mode TEXT DEFAULT 'detailed'`);
    }
  } catch (error: any) {
    console.warn('Error checking/adding response_mode column:', error);
  }

  // Add folder_id column if it doesn't exist (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasFolderId = columns.some((col: any) => col.name === 'folder_id');
    if (!hasFolderId) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL`);
    }
  } catch (error: any) {
    console.warn('Error checking/adding folder_id column:', error);
  }

  // Add ai_provider column if it doesn't exist (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasAiProvider = columns.some((col: any) => col.name === 'ai_provider');
    if (!hasAiProvider) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN ai_provider TEXT DEFAULT 'gemini'`);
    }
  } catch (error: any) {
    console.warn('Error checking/adding ai_provider column:', error);
  }

  // Add document_id column if it doesn't exist (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasDocumentId = columns.some((col: any) => col.name === 'document_id');
    if (!hasDocumentId) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE SET NULL`);
    }
  } catch (error: any) {
    console.warn('Error checking/adding document_id column:', error);
  }

  // Add active_job_id column if it doesn't exist (migration)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasActiveJobId = columns.some((col: any) => col.name === 'active_job_id');
    if (!hasActiveJobId) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN active_job_id TEXT`);
    }
  } catch (error: any) {
    console.warn('Error checking/adding active_job_id column:', error);
  }

  // Create messages table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'summary')),
      content TEXT NOT NULL,
      sources TEXT,
      model TEXT,
      was_grounded INTEGER DEFAULT 0,
      feedback INTEGER CHECK(feedback IN (1, -1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add feedback column or migrate from TEXT to INTEGER
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(messages)`).all();
    const feedbackCol = columns.find((col: any) => col.name === 'feedback');
    if (!feedbackCol) {
      await dbWrapper.exec(`ALTER TABLE messages ADD COLUMN feedback INTEGER CHECK(feedback IN (1, -1))`);
    } else if (feedbackCol.type !== 'INTEGER') {
      // Rebuild table to change feedback from TEXT to INTEGER
      console.log('[DB] Migrating feedback column from TEXT to INTEGER...');
      await dbWrapper.exec(`PRAGMA foreign_keys = OFF`);
      try {
        await dbWrapper.exec(`
          CREATE TABLE messages_feedback_mig (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'summary')),
            content TEXT NOT NULL,
            sources TEXT,
            model TEXT,
            was_grounded INTEGER DEFAULT 0,
            feedback INTEGER CHECK(feedback IN (1, -1)),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
          )
        `);
        await dbWrapper.exec(`
          INSERT INTO messages_feedback_mig (id, conversation_id, role, content, sources, model, was_grounded, feedback, created_at)
          SELECT id, conversation_id, role, content, sources, model, was_grounded,
            CASE feedback WHEN 'like' THEN 1 WHEN 'dislike' THEN -1 ELSE NULL END,
            created_at FROM messages
        `);
        await dbWrapper.exec(`DROP TABLE messages`);
        await dbWrapper.exec(`ALTER TABLE messages_feedback_mig RENAME TO messages`);
        await dbWrapper.exec(`
          CREATE INDEX IF NOT EXISTS idx_messages_conversation
          ON messages(conversation_id, created_at)
        `);
      } finally {
        await dbWrapper.exec(`PRAGMA foreign_keys = ON`);
      }
    }
  } catch (error: any) {
    console.warn('Error adding/migrating feedback column on messages:', error);
  }

  // Migration: Update messages table CHECK constraint to include 'summary'
  try {
    const tableSchema = await dbWrapper.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'`).get();
    if (tableSchema && tableSchema.sql && !tableSchema.sql.includes("'summary'")) {
      console.log('[DB] Migrating messages table to include summary role (safe mode)...');
      await dbWrapper.exec(`PRAGMA foreign_keys = OFF`);
      try {
        // Create new table with temporary name
        await dbWrapper.exec(`
          CREATE TABLE messages_new (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'summary')),
            content TEXT NOT NULL,
            sources TEXT,
            model TEXT,
            was_grounded INTEGER DEFAULT 0,
            feedback INTEGER CHECK(feedback IN (1, -1)),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
          )
        `);

        // Copy data
        await dbWrapper.exec(`
          INSERT INTO messages_new (id, conversation_id, role, content, sources, model, was_grounded, feedback, created_at)
          SELECT id, conversation_id, role, content, sources, model, was_grounded, feedback, created_at FROM messages
        `);

        // Drop old table
        await dbWrapper.exec(`DROP TABLE messages`);

        // Rename new table to messages
        await dbWrapper.exec(`ALTER TABLE messages_new RENAME TO messages`);

        // Recreate index
        await dbWrapper.exec(`
          CREATE INDEX IF NOT EXISTS idx_messages_conversation
          ON messages(conversation_id, created_at)
        `);
      } finally {
        await dbWrapper.exec(`PRAGMA foreign_keys = ON`);
      }
    }
  } catch (error) {
    console.error('[DB] Failed to migrate messages table:', error);
  }

  // Repair: Check for broken file_attachments schema (referencing messages_old)
  // This handles the case where a previous unsafe migration broke the FK reference
  try {
    const faSchema = await dbWrapper.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='file_attachments'`).get();
    if (faSchema && faSchema.sql && faSchema.sql.includes("messages_old")) {
      console.log('[DB] Repairing file_attachments table schema...');
      await dbWrapper.exec(`PRAGMA foreign_keys = OFF`);
      try {
        await dbWrapper.exec(`ALTER TABLE file_attachments RENAME TO file_attachments_old`);

        // Recreate with correct schema
        await dbWrapper.exec(`
          CREATE TABLE file_attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            file_uri TEXT NOT NULL,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            uploaded_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
          )
        `);

        // Copy data
        await dbWrapper.exec(`
          INSERT INTO file_attachments (id, message_id, file_uri, file_name, mime_type, file_size, uploaded_at, created_at)
          SELECT id, message_id, file_uri, file_name, mime_type, file_size, uploaded_at, created_at FROM file_attachments_old
        `);

        await dbWrapper.exec(`DROP TABLE file_attachments_old`);

        await dbWrapper.exec(`
          CREATE INDEX IF NOT EXISTS idx_file_attachments_message
          ON file_attachments(message_id)
        `);
      } finally {
        await dbWrapper.exec(`PRAGMA foreign_keys = ON`);
      }
    }
  } catch (error) {
    console.error('[DB] Failed to repair file_attachments table:', error);
  }

  // Create index for faster message retrieval
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at)
  `);

  // Create file_attachments table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS file_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      file_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);

  // Create index for faster file attachment retrieval
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_attachments_message
    ON file_attachments(message_id)
  `);

  // Create conversation_documents join table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS conversation_documents (
      conversation_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, document_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  // Migration: Move existing document_id from conversations to conversation_documents
  try {
    const existing = await dbWrapper.prepare(`
      SELECT id, document_id FROM conversations WHERE document_id IS NOT NULL
    `).all();

    for (const conv of existing) {
      const exists = await dbWrapper.prepare(`
        SELECT 1 FROM conversation_documents WHERE conversation_id = ? AND document_id = ?
      `).get(conv.id, conv.document_id);

      if (!exists) {
        await dbWrapper.prepare(`
          INSERT INTO conversation_documents (conversation_id, document_id) VALUES (?, ?)
        `).run(conv.id, conv.document_id);
      }
    }
  } catch (error: any) {
    console.warn('Error migrating document_id to conversation_documents:', error);
  }

  // Migration: Add thoughts, thought_signature, and thinking_duration columns to messages
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(messages)`).all();
    const hasThoughts = columns.some((col: any) => col.name === 'thoughts');
    const hasThoughtSignature = columns.some((col: any) => col.name === 'thought_signature');
    const hasThinkingDuration = columns.some((col: any) => col.name === 'thinking_duration');

    if (!hasThoughts) {
      await dbWrapper.exec(`ALTER TABLE messages ADD COLUMN thoughts TEXT`);
    }
    if (!hasThoughtSignature) {
      await dbWrapper.exec(`ALTER TABLE messages ADD COLUMN thought_signature TEXT`);
    }
    if (!hasThinkingDuration) {
      await dbWrapper.exec(`ALTER TABLE messages ADD COLUMN thinking_duration INTEGER`);
    }
  } catch (error: any) {
    console.warn('Error adding thoughts columns to messages:', error);
  }

  // Create shared_links table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS shared_links (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('conversation', 'document')),
      resource_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create index for shared links
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_shared_links_resource
    ON shared_links(resource_id, type)
  `);

  // Migration: Update shared_links CHECK constraint to include 'snapshot'
  try {
    const slSchema = await dbWrapper.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='shared_links'`).get();
    if (slSchema && slSchema.sql && !slSchema.sql.includes("'snapshot'")) {
      console.log('[DB] Migrating shared_links table to include snapshot type...');
      await dbWrapper.exec(`PRAGMA foreign_keys = OFF`);
      try {
        await dbWrapper.exec(`
          CREATE TABLE shared_links_new (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('conversation', 'document', 'snapshot')),
            resource_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);

        await dbWrapper.exec(`
          INSERT INTO shared_links_new (id, type, resource_id, user_id, created_at)
          SELECT id, type, resource_id, user_id, created_at FROM shared_links
        `);

        await dbWrapper.exec(`DROP TABLE shared_links`);
        await dbWrapper.exec(`ALTER TABLE shared_links_new RENAME TO shared_links`);

        await dbWrapper.exec(`
          CREATE INDEX IF NOT EXISTS idx_shared_links_resource
          ON shared_links(resource_id, type)
        `);
      } finally {
        await dbWrapper.exec(`PRAGMA foreign_keys = ON`);
      }
    }
  } catch (error) {
    console.error('[DB] Failed to migrate shared_links table:', error);
  }

  // Create user_kv_store table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS user_kv_store (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create jobs table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('idle','running','stopping','stopped','succeeded','failed')),
      last_seq INTEGER NOT NULL DEFAULT 0,
      last_input_seq INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add user_id column to jobs if it doesn't exist
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(jobs)`).all();
    const hasUserId = columns.some((col: any) => col.name === 'user_id');
    if (!hasUserId) {
      console.log('[DB] Adding user_id column to jobs table...');
      await dbWrapper.exec(`ALTER TABLE jobs ADD COLUMN user_id TEXT`);
    }
  } catch (error: any) {
    console.warn('Error adding user_id column to jobs:', error);
  }

  // Create job_events table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);

  // Create unique index for job events
  await dbWrapper.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_events_job_seq
    ON job_events(job_id, seq)
  `);

  // Create index for job events by kind
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_job_events_job_kind_seq
    ON job_events(job_id, kind, seq)
  `);

  // Create job_queue table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS job_queue (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      input TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK(state IN ('queued','claimed','done','failed')),
      claimed_by TEXT,
      claimed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);

  // Create index for job queue
  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_job_queue_state_priority_created
    ON job_queue(state, priority DESC, created_at)
  `);

  // Track tool-backed sub-jobs linked to conversations/messages
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS conversation_tool_jobs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_job_id TEXT NOT NULL,
      job_id TEXT NOT NULL UNIQUE,
      message_id TEXT,
      tool_name TEXT NOT NULL,
      metadata TEXT,
      state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed','stopped','timeout')),
      output TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_conv_tool_jobs_conversation
    ON conversation_tool_jobs(conversation_id, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_conv_tool_jobs_parent
    ON conversation_tool_jobs(parent_job_id, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_conv_tool_jobs_message
    ON conversation_tool_jobs(message_id, created_at)
  `);

  // Track all tool calls (sync + async) for conversational context and retrieval
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS tool_call_logs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_job_id TEXT,
      message_id TEXT,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','yielded','succeeded','failed')),
      arguments TEXT NOT NULL,
      response TEXT,
      error TEXT,
      async_job_id TEXT,
      yielded_at DATETIME,
      completed_at DATETIME,
      is_retrieval_tool INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);

  // Migration: Add tool_call_logs columns if missing (safe for older local schemas)
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(tool_call_logs)`).all();
    const colNames = columns.map((col: any) => col.name);

    if (!colNames.includes('parent_job_id')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN parent_job_id TEXT`);
    }
    if (!colNames.includes('status')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN status TEXT DEFAULT 'requested'`);
      await dbWrapper.exec(`UPDATE tool_call_logs SET status = 'requested' WHERE status IS NULL OR status = ''`);
    }
    if (!colNames.includes('error')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN error TEXT`);
    }
    if (!colNames.includes('async_job_id')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN async_job_id TEXT`);
    }
    if (!colNames.includes('yielded_at')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN yielded_at DATETIME`);
    }
    if (!colNames.includes('completed_at')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN completed_at DATETIME`);
    }
    if (!colNames.includes('is_retrieval_tool')) {
      await dbWrapper.exec(`ALTER TABLE tool_call_logs ADD COLUMN is_retrieval_tool INTEGER DEFAULT 0`);
    }

    // SQLite cannot alter CHECK constraints in place. Rebuild once to allow 'yielded'.
    const toolCallTableSql = await dbWrapper.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'tool_call_logs'
    `).get() as { sql?: string } | undefined;

    const hasLegacyStatusCheck = toolCallTableSql?.sql?.includes(
      "CHECK(status IN ('requested','succeeded','failed'))"
    );

    if (hasLegacyStatusCheck) {
      await dbWrapper.exec(`PRAGMA foreign_keys = OFF`);
      try {
        await dbWrapper.exec(`ALTER TABLE tool_call_logs RENAME TO tool_call_logs_old`);
        await dbWrapper.exec(`
          CREATE TABLE tool_call_logs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            parent_job_id TEXT,
            message_id TEXT,
            tool_call_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','yielded','succeeded','failed')),
            arguments TEXT NOT NULL,
            response TEXT,
            error TEXT,
            async_job_id TEXT,
            yielded_at DATETIME,
            completed_at DATETIME,
            is_retrieval_tool INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
          )
        `);
        await dbWrapper.exec(`
          INSERT INTO tool_call_logs (
            id,
            conversation_id,
            parent_job_id,
            message_id,
            tool_call_id,
            tool_name,
            status,
            arguments,
            response,
            error,
            async_job_id,
            yielded_at,
            completed_at,
            is_retrieval_tool,
            created_at,
            updated_at
          )
          SELECT
            id,
            conversation_id,
            parent_job_id,
            message_id,
            tool_call_id,
            tool_name,
            CASE
              WHEN status IN ('requested', 'yielded', 'succeeded', 'failed') THEN status
              ELSE 'requested'
            END,
            arguments,
            response,
            error,
            async_job_id,
            yielded_at,
            completed_at,
            COALESCE(is_retrieval_tool, 0),
            created_at,
            updated_at
          FROM tool_call_logs_old
        `);
        await dbWrapper.exec(`DROP TABLE tool_call_logs_old`);
      } finally {
        await dbWrapper.exec(`PRAGMA foreign_keys = ON`);
      }
    }
  } catch (error: any) {
    console.warn('Error migrating tool_call_logs columns:', error);
  }

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_call_logs_conversation
    ON tool_call_logs(conversation_id, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_call_logs_tool_call_id
    ON tool_call_logs(conversation_id, tool_call_id)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_call_logs_status
    ON tool_call_logs(conversation_id, status, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_call_logs_parent
    ON tool_call_logs(parent_job_id, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_tool_call_logs_async_job
    ON tool_call_logs(async_job_id, status, created_at)
  `);

  await dbWrapper.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_call_logs_conversation_tool_call_unique
    ON tool_call_logs(conversation_id, tool_call_id)
  `);

  // Track resumable yield/resume lifecycle per parent chat job
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS chat_yield_sessions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      origin_chat_job_id TEXT NOT NULL UNIQUE,
      origin_exit TEXT NOT NULL CHECK(origin_exit IN ('yield_exit')),
      state TEXT NOT NULL CHECK(state IN ('waiting','resume_queued','resumed','cancelled','failed')),
      yield_note TEXT NOT NULL,
      deadline_at DATETIME NOT NULL,
      next_check_at DATETIME NOT NULL,
      resume_reason TEXT CHECK(resume_reason IN ('all_completed', 'timeout_decision')),
      resume_attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      resume_queued_at DATETIME,
      timed_out_at DATETIME,
      resume_job_id TEXT,
      partial_output TEXT,
      partial_thoughts TEXT,
      partial_thinking_duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (origin_chat_job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (resume_job_id) REFERENCES jobs(id) ON DELETE SET NULL
    )
  `);

  // Migration: Add scheduler/timeout columns to chat_yield_sessions if missing.
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(chat_yield_sessions)`).all();
    const colNames = columns.map((col: any) => col.name);
    if (!colNames.includes('deadline_at')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN deadline_at DATETIME`);
    }
    if (!colNames.includes('next_check_at')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN next_check_at DATETIME`);
    }
    if (!colNames.includes('resume_reason')) {
      await dbWrapper.exec(
        `ALTER TABLE chat_yield_sessions ADD COLUMN resume_reason TEXT CHECK(resume_reason IN ('all_completed', 'timeout_decision'))`
      );
    }
    if (!colNames.includes('resume_attempt_count')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN resume_attempt_count INTEGER DEFAULT 0`);
    }
    if (!colNames.includes('last_error')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN last_error TEXT`);
    }
    if (!colNames.includes('resume_queued_at')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN resume_queued_at DATETIME`);
    }
    if (!colNames.includes('timed_out_at')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN timed_out_at DATETIME`);
    }
    if (!colNames.includes('partial_output')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN partial_output TEXT`);
    }
    if (!colNames.includes('partial_thoughts')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN partial_thoughts TEXT`);
    }
    if (!colNames.includes('partial_thinking_duration')) {
      await dbWrapper.exec(`ALTER TABLE chat_yield_sessions ADD COLUMN partial_thinking_duration INTEGER`);
    }

    const timeoutMsRaw = Number(process.env.YIELD_SESSION_TIMEOUT_MS || '300000');
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : 300000;
    const timeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000));

    await dbWrapper.prepare(`
      UPDATE chat_yield_sessions
      SET deadline_at = COALESCE(deadline_at, DATETIME(COALESCE(created_at, CURRENT_TIMESTAMP), '+' || ? || ' seconds')),
          next_check_at = COALESCE(next_check_at, COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)),
          resume_attempt_count = COALESCE(resume_attempt_count, 0)
      WHERE deadline_at IS NULL
         OR next_check_at IS NULL
         OR resume_attempt_count IS NULL
    `).run(String(timeoutSeconds));

    await dbWrapper.exec(`
      UPDATE chat_yield_sessions
      SET resume_queued_at = COALESCE(resume_queued_at, updated_at, created_at, CURRENT_TIMESTAMP)
      WHERE state = 'resume_queued'
        AND resume_queued_at IS NULL
    `);
  } catch (error: any) {
    console.warn('Error migrating chat_yield_sessions columns:', error);
  }

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_yield_sessions_conversation
    ON chat_yield_sessions(conversation_id, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_yield_sessions_state
    ON chat_yield_sessions(state, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_yield_sessions_schedule
    ON chat_yield_sessions(state, next_check_at, created_at)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_yield_sessions_resume_queue
    ON chat_yield_sessions(state, resume_queued_at)
  `);

  // Create facts table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('core', 'technical', 'project', 'transient')),
      fact TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_facts_user_category ON facts(user_id, category)
  `);

  // Create fact_extractions table (tracks fact-to-conversation links)
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS fact_extractions (
      id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_fact_extractions_fact ON fact_extractions(fact_id)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_fact_extractions_conversation ON fact_extractions(conversation_id)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_fact_extractions_created ON fact_extractions(created_at)
  `);

  // Create fact_sheets table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS fact_sheets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      dedup_log TEXT,
      fact_count INTEGER NOT NULL DEFAULT 0,
      source TEXT DEFAULT 'qwen',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Add source column to fact_sheets if missing (migration)
  try {
    await dbWrapper.exec(`ALTER TABLE fact_sheets ADD COLUMN source TEXT DEFAULT 'qwen'`);
  } catch {
    // Column already exists
  }

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_fact_sheets_user_created ON fact_sheets(user_id, created_at DESC)
  `);

  // Create uploads table for tracking local file ownership
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id)
  `);

  // Create fact_vec virtual table for semantic search (sqlite-vec)
  // Uses cosine distance (0-2 range) for nomic-embed-text embeddings
  // Wrapped in try/catch — vec0 module is only available when sqlite-vec extension is loaded
  try {
    // Migration: drop old L2-distance table and recreate with cosine
    // Check if the table exists but uses L2 (no distance_metric in definition)
    const existingVec = await dbWrapper.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='fact_vec'`
    ).get() as any;
    if (existingVec) {
      // Check if it's using the old L2 metric by looking at the SQL definition
      const tableInfo = await dbWrapper.prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='fact_vec'`
      ).get() as any;
      if (tableInfo?.sql && !tableInfo.sql.includes('cosine')) {
        console.log('[DB] Migrating fact_vec from L2 to cosine distance — dropping old table');
        await dbWrapper.exec(`DROP TABLE fact_vec`);
      }
    }

    await dbWrapper.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fact_vec USING vec0(
        fact_id TEXT PRIMARY KEY,
        user_id TEXT partition key,
        embedding float[768] distance_metric=cosine
      )
    `);
  } catch {
    console.warn('[DB] sqlite-vec not loaded, skipping fact_vec table creation');
  }

  // Migration: Add last_fact_extracted_at column to conversations
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasLastFactExtractedAt = columns.some((col: any) => col.name === 'last_fact_extracted_at');
    if (!hasLastFactExtractedAt) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN last_fact_extracted_at DATETIME DEFAULT NULL`);
    }
  } catch (error: any) {
    console.warn('Error adding last_fact_extracted_at column:', error);
  }

  // Create chat_events table for chronological event-based chat rendering
  await dbWrapper.exec(`
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

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_events_conv_seq
    ON chat_events(conversation_id, seq)
  `);

  await dbWrapper.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_events_kind
    ON chat_events(kind)
  `);

  // Migration: Add feedback column to chat_events
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(chat_events)`).all();
    const hasFeedback = columns.some((col: any) => col.name === 'feedback');
    if (!hasFeedback) {
      await dbWrapper.exec(`ALTER TABLE chat_events ADD COLUMN feedback INTEGER CHECK(feedback IN (1, -1))`);
    }
  } catch (error: any) {
    console.warn('Error adding feedback column to chat_events:', error);
  }

  // Legacy cleanup: training-sample capture was removed.
  await dbWrapper.exec(`DROP TABLE IF EXISTS tmp_facts_ai_training_samples`);

  // Migration: Add source_shared_link_id column to conversations
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasSourceSharedLinkId = columns.some((col: any) => col.name === 'source_shared_link_id');
    if (!hasSourceSharedLinkId) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN source_shared_link_id TEXT DEFAULT NULL`);
    }
  } catch (error: any) {
    console.warn('Error adding source_shared_link_id column:', error);
  }

  // Migration: Add app_id column to conversations
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    const hasAppId = columns.some((col: any) => col.name === 'app_id');
    if (!hasAppId) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN app_id TEXT DEFAULT NULL`);
    }
  } catch (error: any) {
    console.warn('Error adding app_id column:', error);
  }

  // Migration: Add loop_state and loop_job_input columns for infinite loop crash recovery
  try {
    const columns = await dbWrapper.prepare(`PRAGMA table_info(conversations)`).all();
    if (!columns.some((col: any) => col.name === 'loop_state')) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN loop_state TEXT DEFAULT NULL`);
    }
    if (!columns.some((col: any) => col.name === 'loop_job_input')) {
      await dbWrapper.exec(`ALTER TABLE conversations ADD COLUMN loop_job_input TEXT DEFAULT NULL`);
    }
  } catch (error: any) {
    console.warn('Error adding loop_state/loop_job_input columns:', error);
  }

  // Create file_browsers table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS file_browsers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'File Browser',
      current_path TEXT NOT NULL DEFAULT '/',
      user_id TEXT NOT NULL,
      folder_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create apps table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled App',
      description TEXT NOT NULL DEFAULT '',
      folder_id TEXT,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Unique app titles per user
  await dbWrapper.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_user_title
    ON apps(user_id, title)
  `);

  // Create app_secrets table
  await dbWrapper.exec(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      UNIQUE(app_id, key)
    )
  `);
}
