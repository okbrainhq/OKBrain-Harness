import { v4 as uuid } from 'uuid';
import { DbWrapper, ToolCallLog, ToolCallLogStatus } from './db-types';

function toSafeJson(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      serialization_error: 'Failed to serialize value',
      value: String(value),
    });
  }
}

export async function generateNextToolCallId(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string
): Promise<string> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT MAX(CAST(tool_call_id AS INTEGER)) AS max_seq
    FROM tool_call_logs
    WHERE conversation_id = ?
  `).get(conversationId) as { max_seq: number | null } | undefined;

  const next = (row?.max_seq ?? 0) + 1;
  return String(next).padStart(3, '0');
}

export async function addToolCallLog(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  row: {
    conversationId: string;
    parentJobId?: string;
    messageId?: string;
    toolName: string;
    arguments: any;
    status?: ToolCallLogStatus;
    response?: any;
    error?: string | null;
    isRetrievalTool?: boolean;
  }
): Promise<ToolCallLog> {
  await ensureInitialized();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const toolCallId = await generateNextToolCallId(dbWrapper, ensureInitialized, row.conversationId);
    const id = uuid();
    try {
      await dbWrapper.prepare(`
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        id,
        row.conversationId,
        row.parentJobId ?? null,
        row.messageId ?? null,
        toolCallId,
        row.toolName,
        row.status ?? 'requested',
        toSafeJson(row.arguments ?? {}),
        row.response === undefined ? null : toSafeJson(row.response),
        row.error ?? null,
        null,
        null,
        null,
        row.isRetrievalTool ? 1 : 0
      );

      const inserted = await dbWrapper.prepare(`
        SELECT *
        FROM tool_call_logs
        WHERE id = ?
      `).get(id);

      return inserted as ToolCallLog;
    } catch (error: any) {
      const message = String(error?.message || '');
      const isUniqueConflict = message.includes('UNIQUE constraint failed: tool_call_logs.conversation_id, tool_call_logs.tool_call_id');
      if (!isUniqueConflict || attempt === 4) {
        throw error;
      }
    }
  }

  throw new Error('Failed to create tool call log after retries');
}

export async function updateToolCallLogResult(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  toolCallLogId: string,
  data: {
    status: ToolCallLogStatus;
    response?: any;
    error?: string | null;
  }
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE tool_call_logs
    SET status = ?,
        response = ?,
        error = ?,
        completed_at = CASE WHEN ? IN ('succeeded', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.status,
    data.response === undefined ? null : toSafeJson(data.response),
    data.error ?? null,
    data.status,
    toolCallLogId
  );
}

export async function markToolCallLogYielded(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  toolCallLogId: string,
  data: {
    asyncJobId: string;
    response?: any;
  }
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE tool_call_logs
    SET status = 'yielded',
        async_job_id = ?,
        yielded_at = CURRENT_TIMESTAMP,
        response = ?,
        error = NULL,
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.asyncJobId,
    data.response === undefined ? null : toSafeJson(data.response),
    toolCallLogId
  );
}

export async function getRecentToolCallLogs(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  limit: number = 20
): Promise<ToolCallLog[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT *
    FROM tool_call_logs
    WHERE conversation_id = ?
    ORDER BY CAST(tool_call_id AS INTEGER) DESC, created_at DESC
    LIMIT ?
  `).all(conversationId, limit);

  return (rows as ToolCallLog[]).reverse();
}

export async function getToolCallLogByToolCallId(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  toolCallId: string
): Promise<ToolCallLog | undefined> {
  await ensureInitialized();
  const row = await dbWrapper.prepare(`
    SELECT *
    FROM tool_call_logs
    WHERE conversation_id = ? AND tool_call_id = ?
  `).get(conversationId, toolCallId);

  return row as ToolCallLog | undefined;
}

export async function getToolCallLogsByToolCallIds(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  conversationId: string,
  toolCallIds: string[]
): Promise<ToolCallLog[]> {
  await ensureInitialized();
  if (toolCallIds.length === 0) return [];

  const placeholders = toolCallIds.map(() => '?').join(', ');
  const rows = await dbWrapper.prepare(`
    SELECT *
    FROM tool_call_logs
    WHERE conversation_id = ?
      AND tool_call_id IN (${placeholders})
    ORDER BY CAST(tool_call_id AS INTEGER) ASC, created_at ASC
  `).all(conversationId, ...toolCallIds);

  return rows as ToolCallLog[];
}

export async function linkToolCallLogsToMessage(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  parentJobId: string,
  messageId: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE tool_call_logs
    SET message_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE parent_job_id = ?
      AND message_id IS NULL
  `).run(messageId, parentJobId);
}

export async function getYieldedToolCallLogsByParentJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  parentJobId: string
): Promise<ToolCallLog[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT *
    FROM tool_call_logs
    WHERE parent_job_id = ?
      AND status = 'yielded'
    ORDER BY CAST(tool_call_id AS INTEGER) ASC, created_at ASC
  `).all(parentJobId);

  return rows as ToolCallLog[];
}

export async function getAsyncToolCallLogsByParentJob(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  parentJobId: string
): Promise<ToolCallLog[]> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT *
    FROM tool_call_logs
    WHERE parent_job_id = ?
      AND async_job_id IS NOT NULL
    ORDER BY CAST(tool_call_id AS INTEGER) ASC, created_at ASC
  `).all(parentJobId);

  return rows as ToolCallLog[];
}
