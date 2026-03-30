import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser } from './test-utils';
import * as path from 'path';

loadTestEnv();

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  return new Database(dbPath);
}

function seedFacts(userId: string, facts: Array<{ category: string; fact: string }>): string[] {
  const { v4: uuidv4 } = require('uuid');
  const db = getDb();

  const insert = db.prepare(`
    INSERT INTO facts (id, user_id, category, fact, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const ids: string[] = [];
  for (const fact of facts) {
    const id = uuidv4();
    insert.run(id, userId, fact.category, fact.fact, new Date().toISOString());
    ids.push(id);
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  return ids;
}

function seedFactsWithTimestamp(userId: string, facts: Array<{ category: string; fact: string; hoursAgo: number }>): string[] {
  const { v4: uuidv4 } = require('uuid');
  const db = getDb();

  const insert = db.prepare(`
    INSERT INTO facts (id, user_id, category, fact, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const ids: string[] = [];
  for (const fact of facts) {
    const id = uuidv4();
    const createdAt = new Date(Date.now() - fact.hoursAgo * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '');
    insert.run(id, userId, fact.category, fact.fact, createdAt);
    ids.push(id);
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  return ids;
}

function seedFactSheet(
  userId: string,
  entries: Array<{ category: string; fact: string }>,
  source: string = 'qwen'
) {
  const { v4: uuidv4 } = require('uuid');
  const db = getDb();

  db.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, dedup_log, fact_count, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, JSON.stringify(entries), null, entries.length, source, new Date().toISOString());

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

function getFactSheetFromDb(userId: string) {
  const db = getDb();
  db.pragma('wal_checkpoint(FULL)');
  const sheet = db.prepare(
    'SELECT * FROM fact_sheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId);
  db.close();
  return sheet as any;
}

function getFactSheetBySourceFromDb(userId: string, source: string) {
  const db = getDb();
  const sheet = db.prepare(
    'SELECT * FROM fact_sheets WHERE user_id = ? AND source = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId, source);
  db.close();
  return sheet as any;
}

function getAllFactSheetsFromDb(userId: string) {
  const db = getDb();
  db.pragma('wal_checkpoint(FULL)');
  const sheets = db.prepare(
    'SELECT * FROM fact_sheets WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
  db.close();
  return sheets as any[];
}

function getUserIdsWithFactsFromDb() {
  const db = getDb();
  const results = db.prepare('SELECT DISTINCT user_id FROM facts').all();
  db.close();
  return (results as any[]).map((row) => row.user_id);
}

function getRecentFactsByHoursFromDb(userId: string, hours: number) {
  const db = getDb();
  const results = db.prepare(`
    SELECT f.id, f.user_id, f.category, f.fact, f.created_at
    FROM facts f
    WHERE f.user_id = ? AND f.created_at > datetime('now', '-' || ? || ' hours')
    ORDER BY f.created_at DESC
  `).all(userId, hours);
  db.close();
  return results as any[];
}

test.describe('Fact Sheet Source Column', () => {
  test.describe.configure({ mode: 'serial' });

  test('should save fact sheet with source column', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [{ category: 'core', fact: 'Running fact' }], 'qwen');
    seedFactSheet(user.id, [{ category: 'core', fact: 'Daily fact' }], 'gemini');

    const allSheets = getAllFactSheetsFromDb(user.id);
    expect(allSheets.length).toBe(2);

    const sources = allSheets.map((sheet: any) => sheet.source);
    expect(sources).toContain('qwen');
    expect(sources).toContain('gemini');
  });

  test('should query fact sheet by source', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [{ category: 'core', fact: 'Old running fact' }], 'qwen');
    await new Promise((resolve) => setTimeout(resolve, 50));
    seedFactSheet(user.id, [{ category: 'core', fact: 'Daily fact' }], 'gemini');
    await new Promise((resolve) => setTimeout(resolve, 50));
    seedFactSheet(user.id, [{ category: 'core', fact: 'New running fact' }], 'qwen');

    const latest = getFactSheetFromDb(user.id);
    const latestFacts = JSON.parse(latest.facts_json);
    expect(latestFacts[0].fact).toBe('New running fact');

    const geminiSheet = getFactSheetBySourceFromDb(user.id, 'gemini');
    expect(geminiSheet).not.toBeNull();
    const geminiFacts = JSON.parse(geminiSheet.facts_json);
    expect(geminiFacts[0].fact).toBe('Daily fact');
  });
});

test.describe('DB Helpers', () => {
  test.describe.configure({ mode: 'serial' });

  test('getUserIdsWithFacts returns distinct user IDs', async ({ page }) => {
    const user1 = await setupPageWithUser(page);
    const user2 = await setupPageWithUser(page);

    seedFacts(user1.id, [{ category: 'core', fact: 'User 1 fact' }]);
    seedFacts(user2.id, [{ category: 'core', fact: 'User 2 fact' }]);

    const userIds = getUserIdsWithFactsFromDb();
    expect(userIds).toContain(user1.id);
    expect(userIds).toContain(user2.id);
  });

  test('getRecentFactsByHours returns only facts within time window', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactsWithTimestamp(user.id, [
      { category: 'core', fact: 'Recent fact 1', hoursAgo: 2 },
      { category: 'core', fact: 'Recent fact 2', hoursAgo: 5 },
      { category: 'core', fact: 'Old fact', hoursAgo: 10 },
      { category: 'core', fact: 'Very old fact', hoursAgo: 48 },
    ]);

    const recent6h = getRecentFactsByHoursFromDb(user.id, 6).map((fact: any) => fact.fact);
    expect(recent6h).toContain('Recent fact 1');
    expect(recent6h).toContain('Recent fact 2');
    expect(recent6h).not.toContain('Old fact');
    expect(recent6h).not.toContain('Very old fact');

    const recent24h = getRecentFactsByHoursFromDb(user.id, 24).map((fact: any) => fact.fact);
    expect(recent24h).toContain('Recent fact 1');
    expect(recent24h).toContain('Old fact');
    expect(recent24h).not.toContain('Very old fact');
  });
});

test.describe('Fact Sheet Shape', () => {
  test.describe.configure({ mode: 'serial' });

  test('fact sheet entries display correctly in UI', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [
      { category: 'core', fact: 'Lives in Sri Lanka' },
      { category: 'core', fact: 'Has a family of four' },
      { category: 'technical', fact: 'Uses TypeScript' },
      { category: 'transient', fact: 'Looking at new laptop' },
    ], 'qwen');

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    await expect(page.locator('.me-fact-item')).toHaveCount(4);
    await expect(page.locator('.me-fact-badge-core')).toHaveCount(2);
    await expect(page.locator('.me-fact-badge-technical')).toHaveCount(1);
    await expect(page.locator('.me-fact-badge-transient')).toHaveCount(1);
    await expect(page.locator('.me-fact-text', { hasText: 'Lives in Sri Lanka' })).toBeVisible();
    await expect(page.locator('.me-fact-text', { hasText: 'Uses TypeScript' })).toBeVisible();
  });

  test('API returns category and fact fields', async ({ page, request }) => {
    const user = await setupPageWithUser(page);
    const headers = { Cookie: `auth-token=${user.token}` };

    seedFactSheet(user.id, [
      { category: 'core', fact: 'API fact 1' },
      { category: 'technical', fact: 'API fact 2' },
      { category: 'project', fact: 'API fact 3' },
    ], 'qwen');

    const res = await request.get('http://localhost:3001/api/fact-sheet', { headers });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.facts.length).toBe(3);
    expect(data.fact_count).toBe(3);
    expect(data.source).toBe('qwen');

    for (const fact of data.facts) {
      expect(fact.category).toBeTruthy();
      expect(fact.fact).toBeTruthy();
    }
  });
});

test.describe('Fact Sheet API Selection', () => {
  test.describe.configure({ mode: 'serial' });

  test('latest fact sheet returned regardless of source', async ({ page, request }) => {
    const user = await setupPageWithUser(page);
    const headers = { Cookie: `auth-token=${user.token}` };

    seedFactSheet(user.id, [{ category: 'core', fact: 'Running' }], 'qwen');
    await new Promise((resolve) => setTimeout(resolve, 50));
    seedFactSheet(user.id, [{ category: 'core', fact: 'Daily' }], 'gemini');

    const res = await request.get('http://localhost:3001/api/fact-sheet', { headers });
    const data = await res.json();
    expect(data.facts[0].fact).toBe('Daily');
  });
});
