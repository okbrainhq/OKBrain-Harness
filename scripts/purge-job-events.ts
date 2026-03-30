/**
 * Purge non-tool job events from the database to reclaim space.
 *
 * Keeps only shell-command job events (tool jobs).
 * Deletes chat, summarize, fact-extraction, highlights, memory-learn events.
 *
 * Usage: npx tsx scripts/purge-job-events.ts [db-path]
 *
 * This is an OFFLINE operation. Stop the app before running.
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const dbPath = process.argv[2] || path.join(process.cwd(), 'brain.db');
console.log(`[Purge] Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

try {
  // Count before
  const totalBefore = (db.prepare('SELECT COUNT(*) as count FROM job_events').get() as { count: number }).count;
  const keepCount = (db.prepare(`
    SELECT COUNT(*) as count FROM job_events
    WHERE job_id IN (SELECT id FROM jobs WHERE type = 'shell-command')
  `).get() as { count: number }).count;

  console.log(`[Purge] Total job_events: ${totalBefore}`);
  console.log(`[Purge] Keeping (shell-command): ${keepCount}`);
  console.log(`[Purge] Deleting: ${totalBefore - keepCount}`);

  // Delete non-tool job events
  console.log('[Purge] Deleting non-tool job events...');
  const result = db.prepare(`
    DELETE FROM job_events
    WHERE job_id IN (SELECT id FROM jobs WHERE type != 'shell-command')
  `).run();
  console.log(`[Purge] Deleted ${result.changes} rows`);

  // Vacuum to reclaim space
  console.log('[Purge] Running VACUUM to reclaim disk space...');
  db.exec('VACUUM');

  const totalAfter = (db.prepare('SELECT COUNT(*) as count FROM job_events').get() as { count: number }).count;
  console.log(`[Purge] Done. Remaining job_events: ${totalAfter}`);
} finally {
  db.close();
}
