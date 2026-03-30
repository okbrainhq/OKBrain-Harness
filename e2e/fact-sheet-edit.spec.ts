import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser } from './test-utils';
import * as path from 'path';

loadTestEnv();

// Helper: seed a fact_sheet directly with source
function seedFactSheet(
  userId: string,
  entries: Array<{ category: string; fact: string }>,
  source: string = 'qwen'
): string {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, dedup_log, fact_count, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, JSON.stringify(entries), null, entries.length, source, new Date().toISOString());

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  return id;
}

// Helper: get fact sheet from DB
function getFactSheetFromDb(userId: string) {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const sheet = db.prepare(
    'SELECT * FROM fact_sheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId);

  db.close();
  return sheet as any;
}

// Helper: get fact sheet by ID
function getFactSheetById(sheetId: string) {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const sheet = db.prepare(
    'SELECT * FROM fact_sheets WHERE id = ?'
  ).get(sheetId);

  db.close();
  return sheet as any;
}

test.describe('Fact Sheet Edit & Delete', () => {
  test.describe.configure({ mode: 'parallel' });

  test('should edit a fact sheet entry via UI', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [
      { category: 'core', fact: 'Lives in Tokyo' },
      { category: 'technical', fact: 'Uses Python' },
      { category: 'transient', fact: 'Shopping for headphones' },
    ]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    // Wait for fact sheet to load
    await expect(page.locator('.me-fact-item')).toHaveCount(3);

    // Click edit on the second fact
    const secondItem = page.locator('.me-fact-item').nth(1);
    await secondItem.hover();
    await secondItem.locator('.me-fact-action-edit').click();

    // Should show edit input
    const editInput = secondItem.locator('.me-fact-edit-input');
    await expect(editInput).toBeVisible();

    // Change the text and wait for PATCH
    await editInput.fill('Uses Rust');
    const editResponse = page.waitForResponse(resp => resp.url().includes('/api/fact-sheet') && resp.request().method() === 'PATCH');
    await editInput.press('Enter');
    await editResponse;

    // Verify the text updated in UI
    await expect(page.locator('.me-fact-text', { hasText: 'Uses Rust' })).toBeVisible();
    await expect(page.locator('.me-fact-text', { hasText: 'Uses Python' })).not.toBeVisible();

    // Verify in DB
    const sheet = getFactSheetFromDb(user.id);
    const facts = JSON.parse(sheet.facts_json);
    expect(facts[1].fact).toBe('Uses Rust');
    expect(facts.length).toBe(3);
  });

  test('should delete a fact sheet entry via UI', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [
      { category: 'core', fact: 'Lives in London' },
      { category: 'technical', fact: 'Uses Go' },
      { category: 'project', fact: 'Building a game' },
    ]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    await expect(page.locator('.me-fact-item')).toHaveCount(3);

    // Delete the second fact
    const secondItem = page.locator('.me-fact-item').nth(1);
    await secondItem.hover();

    page.on('dialog', dialog => dialog.accept());
    const deleteResponse = page.waitForResponse(resp => resp.url().includes('/api/fact-sheet') && resp.request().method() === 'PATCH');
    await secondItem.locator('.me-fact-action-delete').click();
    await deleteResponse;

    // Should now have 2 facts
    await expect(page.locator('.me-fact-item')).toHaveCount(2);
    await expect(page.locator('.me-fact-text', { hasText: 'Uses Go' })).not.toBeVisible();

    // Verify in DB
    const sheet = getFactSheetFromDb(user.id);
    const facts = JSON.parse(sheet.facts_json);
    expect(facts.length).toBe(2);
    expect(facts.map((f: any) => f.fact)).not.toContain('Uses Go');
  });

  test('should change category of a fact sheet entry', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [
      { category: 'transient', fact: 'Interested in Rust' },
      { category: 'core', fact: 'Has a dog' },
    ]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    await expect(page.locator('.me-fact-item')).toHaveCount(2);

    // Edit first fact's category
    const firstItem = page.locator('.me-fact-item').nth(0);
    await firstItem.hover();
    await firstItem.locator('.me-fact-action-edit').click();

    // Change category to technical and wait for PATCH
    await firstItem.locator('.me-fact-category-select').selectOption('technical');
    const catResponse = page.waitForResponse(resp => resp.url().includes('/api/fact-sheet') && resp.request().method() === 'PATCH');
    await firstItem.locator('.me-fact-edit-input').press('Enter');
    await catResponse;

    // Verify the badge changed
    await expect(firstItem.locator('.me-fact-badge-technical')).toBeVisible();

    // Verify in DB
    const sheet = getFactSheetFromDb(user.id);
    const facts = JSON.parse(sheet.facts_json);
    expect(facts[0].category).toBe('technical');
  });

  test('should show edit/delete on both running and daily versions', async ({ page }) => {
    const user = await setupPageWithUser(page);

    // Seed both running (qwen) and daily (gemini) sheets
    // Seed daily first (older), then running (newer)
    seedFactSheet(user.id, [
      { category: 'core', fact: 'Daily fact one' },
      { category: 'technical', fact: 'Daily fact two' },
    ], 'gemini');

    // Small delay to ensure different timestamps
    await page.waitForTimeout(100);

    seedFactSheet(user.id, [
      { category: 'core', fact: 'Running fact one' },
      { category: 'project', fact: 'Running fact two' },
      { category: 'transient', fact: 'Running fact three' },
    ], 'qwen');

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    // Running version should show by default
    await expect(page.locator('.me-fact-item')).toHaveCount(3);
    await expect(page.locator('.me-fact-text', { hasText: 'Running fact one' })).toBeVisible();

    // Hover to see edit/delete actions on running version
    const firstItem = page.locator('.me-fact-item').nth(0);
    await firstItem.hover();
    await expect(firstItem.locator('.me-fact-action-edit')).toBeVisible();
    await expect(firstItem.locator('.me-fact-action-delete')).toBeVisible();

    // Switch to daily version
    await page.locator('.me-fact-sheet-source-btn:has-text("Daily")').click();

    // Daily version should show
    await expect(page.locator('.me-fact-item')).toHaveCount(2);
    await expect(page.locator('.me-fact-text', { hasText: 'Daily fact one' })).toBeVisible();

    // Edit/delete actions should also be available on daily version
    const dailyItem = page.locator('.me-fact-item').nth(0);
    await dailyItem.hover();
    await expect(dailyItem.locator('.me-fact-action-edit')).toBeVisible();
    await expect(dailyItem.locator('.me-fact-action-delete')).toBeVisible();
  });

  test('should edit a fact on the daily sheet', async ({ page }) => {
    const user = await setupPageWithUser(page);

    const sheetId = seedFactSheet(user.id, [
      { category: 'core', fact: 'Daily core fact' },
      { category: 'technical', fact: 'Daily tech fact' },
    ], 'gemini');

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    // Switch to daily version
    await page.locator('.me-fact-sheet-source-btn:has-text("Daily")').click();
    await expect(page.locator('.me-fact-item')).toHaveCount(2);

    // Edit the first fact
    const firstItem = page.locator('.me-fact-item').nth(0);
    await firstItem.hover();
    await firstItem.locator('.me-fact-action-edit').click();

    const editInput = firstItem.locator('.me-fact-edit-input');
    await expect(editInput).toBeVisible();

    await editInput.fill('Updated daily fact');
    const editResponse = page.waitForResponse(resp => resp.url().includes('/api/fact-sheet') && resp.request().method() === 'PATCH');
    await editInput.press('Enter');
    await editResponse;

    // Verify the text updated in UI
    await expect(page.locator('.me-fact-text', { hasText: 'Updated daily fact' })).toBeVisible();
    await expect(page.locator('.me-fact-text', { hasText: 'Daily core fact' })).not.toBeVisible();

    // Verify in DB
    const sheet = getFactSheetById(sheetId);
    const facts = JSON.parse(sheet.facts_json);
    expect(facts[0].fact).toBe('Updated daily fact');
    expect(facts.length).toBe(2);
  });

  test('should delete a fact on the daily sheet', async ({ page }) => {
    const user = await setupPageWithUser(page);

    const sheetId = seedFactSheet(user.id, [
      { category: 'core', fact: 'Daily keep' },
      { category: 'technical', fact: 'Daily remove' },
      { category: 'project', fact: 'Daily also keep' },
    ], 'gemini');

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    // Switch to daily version
    await page.locator('.me-fact-sheet-source-btn:has-text("Daily")').click();
    await expect(page.locator('.me-fact-item')).toHaveCount(3);

    // Delete the second fact
    const secondItem = page.locator('.me-fact-item').nth(1);
    await secondItem.hover();

    page.on('dialog', dialog => dialog.accept());
    const deleteResponse = page.waitForResponse(resp => resp.url().includes('/api/fact-sheet') && resp.request().method() === 'PATCH');
    await secondItem.locator('.me-fact-action-delete').click();
    await deleteResponse;

    // Should now have 2 facts
    await expect(page.locator('.me-fact-item')).toHaveCount(2);
    await expect(page.locator('.me-fact-text', { hasText: 'Daily remove' })).not.toBeVisible();

    // Verify in DB
    const sheet = getFactSheetById(sheetId);
    const facts = JSON.parse(sheet.facts_json);
    expect(facts.length).toBe(2);
    expect(facts.map((f: any) => f.fact)).not.toContain('Daily remove');
  });

  test('should show source in metadata', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [
      { category: 'core', fact: 'Test fact' },
    ], 'qwen');

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    await expect(page.locator('.me-fact-sheet-meta')).toContainText('qwen');
    await expect(page.locator('.me-fact-sheet-meta')).toContainText('1 facts');
  });

  test('should update fact count in metadata after delete', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFactSheet(user.id, [
      { category: 'core', fact: 'Fact A' },
      { category: 'core', fact: 'Fact B' },
      { category: 'core', fact: 'Fact C' },
    ]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Fact Sheet")').click();

    await expect(page.locator('.me-fact-sheet-meta')).toContainText('3 facts');

    // Delete one
    page.on('dialog', dialog => dialog.accept());
    const firstItem = page.locator('.me-fact-item').nth(0);
    await firstItem.hover();
    const delResponse = page.waitForResponse(resp => resp.url().includes('/api/fact-sheet') && resp.request().method() === 'PATCH');
    await firstItem.locator('.me-fact-action-delete').click();
    await delResponse;

    // Should now have 2 facts
    await expect(page.locator('.me-fact-item')).toHaveCount(2);
  });
});
