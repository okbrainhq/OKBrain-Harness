import { DbWrapper } from './db-types';

const SHARED_FOLDER_SUBQUERY = `
  folder_id IN (SELECT id FROM folders WHERE is_shared = 1)
`;

// App CRUD

export async function createApp(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  folderId: string | null = null
) {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO apps (id, title, user_id, folder_id) VALUES (?, ?, ?, ?)
  `).run(id, title, userId, folderId);

  return (await getApp(dbWrapper, ensureInitialized, userId, id))!;
}

export async function getApp(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
) {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT * FROM apps
    WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).get(id, userId);
  return result || null;
}

export async function getAppByTitle(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  title: string
) {
  await ensureInitialized();
  const result = await dbWrapper.prepare(`
    SELECT * FROM apps
    WHERE title = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
  `).get(title, userId);
  return result || null;
}

/**
 * Resolve an app identifier (title or UUID) to the app row.
 */
export async function resolveApp(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  identifier: string
) {
  // Try by title first (most common from AI tool calls)
  const byTitle = await getAppByTitle(dbWrapper, ensureInitialized, userId, identifier);
  if (byTitle) return byTitle;
  // Fall back to UUID lookup
  return getApp(dbWrapper, ensureInitialized, userId, identifier);
}

export async function updateApp(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title?: string,
  description?: string
) {
  await ensureInitialized();
  if (title !== undefined && description !== undefined) {
    await dbWrapper.prepare(`
      UPDATE apps SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
    `).run(title, description, id, userId);
  } else if (title !== undefined) {
    await dbWrapper.prepare(`
      UPDATE apps SET title = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
    `).run(title, id, userId);
  } else if (description !== undefined) {
    await dbWrapper.prepare(`
      UPDATE apps SET description = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
    `).run(description, id, userId);
  }
}

export async function deleteApp(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
) {
  await ensureInitialized();
  await dbWrapper.prepare("DELETE FROM apps WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function moveAppToFolder(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  getFolder: (userId: string, id: string) => Promise<any>,
  userId: string,
  appId: string,
  folderId: string | null
) {
  await ensureInitialized();
  const app = await getApp(dbWrapper, ensureInitialized, userId, appId);
  if (!app) return;

  if (folderId) {
    const folder = await getFolder(userId, folderId);
    if (!folder) return;
  }

  await dbWrapper.prepare(`
    UPDATE apps SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
  `).run(folderId, appId, userId);
}

export async function searchApps(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  query: string
) {
  await ensureInitialized();
  const searchPattern = `%${query}%`;
  const startsWithPattern = `${query}%`;
  const results = await dbWrapper.prepare(`
    SELECT * FROM apps
    WHERE (user_id = ? OR ${SHARED_FOLDER_SUBQUERY})
      AND (title LIKE ? OR description LIKE ?)
    ORDER BY
      CASE WHEN title LIKE ? THEN 0 ELSE 1 END,
      updated_at DESC
  `).all(userId, searchPattern, searchPattern, startsWithPattern);
  return results;
}

export async function getAllApps(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
) {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT * FROM apps
    WHERE user_id = ? OR ${SHARED_FOLDER_SUBQUERY}
    ORDER BY updated_at DESC
  `).all(userId);
  return results;
}

export async function getAppNames(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  limit: number = 10
) {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT id, title FROM apps
    WHERE user_id = ? OR ${SHARED_FOLDER_SUBQUERY}
    ORDER BY updated_at DESC LIMIT ?
  `).all(userId, limit);
  return results as Array<{ id: string; title: string }>;
}

// App Secrets CRUD

export async function getAppSecrets(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  appId: string
) {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT * FROM app_secrets WHERE app_id = ? ORDER BY key ASC
  `).all(appId);
  return results as Array<{ id: string; app_id: string; key: string; value: string; created_at: string; updated_at: string }>;
}

export async function getAppSecretKeys(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  appId: string
) {
  await ensureInitialized();
  const results = await dbWrapper.prepare(`
    SELECT key FROM app_secrets WHERE app_id = ? ORDER BY key ASC
  `).all(appId);
  return (results as Array<{ key: string }>).map(r => r.key);
}

export async function setAppSecret(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  id: string,
  appId: string,
  key: string,
  value: string
) {
  await ensureInitialized();
  // Upsert: insert or update on conflict
  await dbWrapper.prepare(`
    INSERT INTO app_secrets (id, app_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(app_id, key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(id, appId, key, value, value);
}

export async function deleteAppSecret(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  appId: string,
  key: string
) {
  await ensureInitialized();
  await dbWrapper.prepare(`
    DELETE FROM app_secrets WHERE app_id = ? AND key = ?
  `).run(appId, key);
}

/**
 * Get recent successful run_app calls for a user (last N days).
 * Returns app_name and args from the tool_call_logs arguments JSON.
 */
export async function getRecentRunAppCalls(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  days: number = 7
): Promise<Array<{ app_name: string; args: string }>> {
  await ensureInitialized();
  const rows = await dbWrapper.prepare(`
    SELECT
      COALESCE(json_extract(t.arguments, '$.app_name'), a.title) as app_name,
      json_extract(t.arguments, '$.args') as args
    FROM tool_call_logs t
    JOIN conversations c ON c.id = t.conversation_id
    LEFT JOIN apps a ON a.id = json_extract(t.arguments, '$.app_id')
    WHERE t.tool_name = 'run_app'
      AND t.status = 'succeeded'
      AND t.created_at > datetime('now', '-' || ? || ' days')
      AND c.user_id = ?
    ORDER BY t.created_at DESC
  `).all(days, userId);
  return (rows as Array<{ app_name: string | null; args: string | null }>)
    .filter(r => r.app_name)
    .map(r => ({ app_name: r.app_name!, args: r.args || '' }));
}

export async function getAppSecretsAsEnv(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  appId: string
): Promise<Record<string, string>> {
  const secrets = await getAppSecrets(dbWrapper, ensureInitialized, appId);
  const env: Record<string, string> = {};
  for (const s of secrets) {
    env[s.key] = s.value;
  }
  return env;
}
