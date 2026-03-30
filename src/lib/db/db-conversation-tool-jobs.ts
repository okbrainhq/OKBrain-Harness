import { DbWrapper, ConversationToolJob, ConversationToolJobState } from './db-types';

export async function addConversationToolJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  row: {
    id: string;
    conversationId: string;
    parentJobId: string;
    jobId: string;
    toolName: string;
    metadata?: object;
  }
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT OR REPLACE INTO conversation_tool_jobs (
      id, conversation_id, parent_job_id, job_id, tool_name, metadata, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', COALESCE((SELECT created_at FROM conversation_tool_jobs WHERE job_id = ?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
  `).run(
    row.id,
    row.conversationId,
    row.parentJobId,
    row.jobId,
    row.toolName,
    row.metadata ? JSON.stringify(row.metadata) : null,
    row.jobId
  );
}

export async function updateConversationToolJobState(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string,
  state: ConversationToolJobState,
  output?: object,
  error?: string | null
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversation_tool_jobs
    SET state = ?, output = ?, error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE job_id = ?
  `).run(state, output ? JSON.stringify(output) : null, error ?? null, jobId);
}

export async function linkToolJobsToMessage(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  parentJobId: string,
  messageId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE conversation_tool_jobs
    SET message_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE parent_job_id = ?
  `).run(messageId, parentJobId);
}

export async function getConversationToolJobs(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<ConversationToolJob[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT * FROM conversation_tool_jobs
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId);
  return rows as ConversationToolJob[];
}

export async function getConversationToolJobsByParentJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  parentJobId: string
): Promise<ConversationToolJob[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT * FROM conversation_tool_jobs
    WHERE parent_job_id = ?
    ORDER BY created_at ASC
  `).all(parentJobId);
  return rows as ConversationToolJob[];
}

export async function getConversationToolJobByJobId(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  jobId: string
): Promise<ConversationToolJob | undefined> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT *
    FROM conversation_tool_jobs
    WHERE job_id = ?
  `).get(jobId);
  return row as ConversationToolJob | undefined;
}
