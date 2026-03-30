import { test, expect } from '@playwright/test';
import * as path from 'path';
import { setupPageWithUser } from './test-utils';

// Seed highlights using the job system. Each entry: { offset in ms, text }
// If a view is omitted it won't be seeded (will appear stale/empty).
type ViewSeed = { offset: number; text: string };

function seedHighlightsJobs(userId: string, views: { today?: ViewSeed; tomorrow?: ViewSeed; week?: ViewSeed }) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  // Always seed the prompt with the earliest timestamp so it doesn't interfere
  const earliestOffset = Math.max(
    views.today?.offset ?? 0,
    views.tomorrow?.offset ?? 0,
    views.week?.offset ?? 0
  );

  const upsertKV = db.prepare(`
    INSERT INTO user_kv_store (user_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  upsertKV.run(userId, 'highlights:prompt', 'Test prompt', new Date(Date.now() - earliestOffset).toISOString());

  // Delete existing jobs for this user
  const deleteJobs = db.prepare(`DELETE FROM jobs WHERE id LIKE ?`);
  deleteJobs.run(`highlights:${userId}:%`);

  // Create job and events for each view
  const insertJob = db.prepare(`
    INSERT INTO jobs (id, type, user_id, state, last_seq, last_input_seq, created_at, updated_at)
    VALUES (?, 'highlights', ?, 'succeeded', ?, 1, ?, ?)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO job_events (id, job_id, seq, kind, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const [view, seed] of Object.entries(views)) {
    const jobId = `highlights:${userId}:${view}`;
    const ts = new Date(Date.now() - seed.offset).toISOString();

    // Create the job in succeeded state
    insertJob.run(jobId, userId, 2, ts, ts);

    // Add input event
    insertEvent.run(
      uuidv4(),
      jobId,
      1,
      'input',
      JSON.stringify({ userId, view, userPrompt: 'Test prompt' }),
      ts
    );

    // Add output event with the highlight text
    insertEvent.run(
      uuidv4(),
      jobId,
      2,
      'output',
      JSON.stringify({ text: seed.text }),
      ts
    );
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

test.describe('Highlights Feature', () => {
  test.setTimeout(90000); // Allow up to 90s for real AI generation

  test('should display highlights section structure', async ({ page }) => {
    await page.goto('/');

    // Ensure the section is visible (using .first() to handle strict mode violations if multiple exist)
    await expect(page.locator('.highlights-section').first()).toBeVisible();

    // Check key elements strictly required by design
    await expect(page.locator('.highlights-title').first()).toContainText('NEXT 24H');

    // The content wrapper should always be visible
    await expect(page.locator('.highlights-content').first()).toBeVisible();
  });

  test('should edit prompt and regenerate', async ({ page }) => {
    // Create isolated user with fresh highlights so we don't compete with other tests
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 0, text: 'Initial today text' },
      tomorrow: { offset: 0, text: 'Initial tomorrow text' },
      week: { offset: 0, text: 'Initial week text' },
    });

    await page.goto('/');

    await page.locator('.highlight-action-btn[title="Edit"]').first().click();
    await expect(page.locator('.highlight-edit-modal')).toBeVisible();

    const newPrompt = `Show me events, news and interesting things ${Date.now()}`;
    await page.locator('.highlight-edit-modal textarea').fill(newPrompt);
    await page.locator('text=Save').click();

    await expect(page.locator('.highlight-edit-modal')).not.toBeVisible();

    // Wait for completion (footer time update is a proxy for "done")
    await expect(page.locator('.highlights-footer').first()).toContainText('ago', { timeout: 60000 });
  });

  test('should auto-regenerate and spin refresh icon when job is older than 1 hour', async ({ page }) => {
    // Step 1: Create isolated user and seed stale today (2 hours old), fresh tomorrow+week
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 2 * 60 * 60 * 1000, text: 'Old stale highlight text' },
      tomorrow: { offset: 0, text: 'Fresh tomorrow text' },
      week: { offset: 0, text: 'Fresh week text' },
    });

    // Step 2: Navigate to home page
    await page.goto('/');

    // Step 3: Verify stale data is rendered from SSR
    await expect(page.locator('.highlights-content').first()).toContainText('Old stale highlight text');
    await expect(page.locator('.highlights-footer').first()).toContainText('120 min ago');

    // Step 4: Client should detect staleness and trigger generation - wait for spin
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin').first()).toBeVisible({ timeout: 10000 });

    // Step 5: Wait for generation to complete - spin should disappear
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin')).not.toBeVisible({ timeout: 60000 });

    // Step 6: Footer should show fresh timestamp
    await expect(page.locator('.highlights-footer').first()).toContainText('0 min ago', { timeout: 5000 });

    // Step 7: Content should be updated (no longer stale text)
    await expect(page.locator('.highlights-content').first()).not.toContainText('Old stale highlight text');
  });

  test('should show SSR data without regenerating when job is within 1 hour', async ({ page }) => {
    // Step 1: Create isolated user and seed all views fresh (30 minutes old)
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 30 * 60 * 1000, text: 'Old stale highlight text' },
      tomorrow: { offset: 30 * 60 * 1000, text: 'Fresh tomorrow text' },
      week: { offset: 30 * 60 * 1000, text: 'Fresh week text' },
    });

    // Step 2: Navigate to home page
    await page.goto('/');

    // Step 3: Verify SSR data is rendered
    await expect(page.locator('.highlights-content').first()).toContainText('Old stale highlight text');
    await expect(page.locator('.highlights-footer').first()).toContainText('30 min ago');

    // Step 4: Wait a moment and verify NO regeneration happens (no spin)
    await page.waitForTimeout(2000);
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin')).not.toBeVisible();

    // Step 5: Content should still be the seeded data
    await expect(page.locator('.highlights-content').first()).toContainText('Old stale highlight text');
  });

  test('should regenerate real data when clicking refresh button', async ({ page }) => {
    // Step 1: Create isolated user and seed all views fresh (10 minutes old)
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 10 * 60 * 1000, text: 'Old stale highlight text' },
      tomorrow: { offset: 10 * 60 * 1000, text: 'Fresh tomorrow text' },
      week: { offset: 10 * 60 * 1000, text: 'Fresh week text' },
    });

    // Step 2: Navigate to home page
    await page.goto('/');

    // Step 3: Verify fake data is shown
    await expect(page.locator('.highlights-content').first()).toContainText('Old stale highlight text');
    await expect(page.locator('.highlights-footer').first()).toContainText('10 min ago');

    // Step 4: Click refresh button to force regeneration
    await page.locator('.highlight-action-btn[title="Refresh"]').first().click();

    // Step 5: Verify spinner appears
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin').first()).toBeVisible({ timeout: 5000 });

    // Step 6: Wait for generation to complete
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin')).not.toBeVisible({ timeout: 60000 });

    // Step 7: Verify new content is generated (not the fake text)
    await expect(page.locator('.highlights-content').first()).not.toContainText('Old stale highlight text');

    // Step 8: Footer should show fresh timestamp
    await expect(page.locator('.highlights-footer').first()).toContainText('0 min ago');

    // Step 9: Verify actual content was generated (should have some real text)
    const content = await page.locator('.highlights-content').first().innerText();
    expect(content.length).toBeGreaterThan(20);
  });

  test('should navigate between Today, Tomorrow, and This Week via arrows', async ({ page }) => {
    // Seed all views fresh so no auto-regeneration fires
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 0, text: 'Today content' },
      tomorrow: { offset: 0, text: 'Tomorrow content' },
      week: { offset: 0, text: 'Week content' },
    });

    await page.goto('/');

    // Starts on NEXT 24H (today)
    await expect(page.locator('.highlights-title').first()).toContainText('NEXT 24H');
    await expect(page.locator('.highlights-content').first()).toContainText('Today content');

    // Left arrow should not be visible on first view
    await expect(page.locator('.highlights-arrow[aria-label="Previous"]')).not.toBeVisible();

    // Navigate to NEXT 48H (tomorrow)
    await page.locator('.highlights-arrow[aria-label="Next"]').first().click();
    await expect(page.locator('.highlights-title').first()).toContainText('NEXT 48H');
    await expect(page.locator('.highlights-content').first()).toContainText('Tomorrow content');

    // Navigate to THIS WEEK
    await page.locator('.highlights-arrow[aria-label="Next"]').first().click();
    await expect(page.locator('.highlights-title').first()).toContainText('THIS WEEK');
    await expect(page.locator('.highlights-content').first()).toContainText('Week content');

    // Right arrow should not be visible on last view
    await expect(page.locator('.highlights-arrow[aria-label="Next"]')).not.toBeVisible();

    // Navigate back to NEXT 48H (tomorrow)
    await page.locator('.highlights-arrow[aria-label="Previous"]').first().click();
    await expect(page.locator('.highlights-title').first()).toContainText('NEXT 48H');
  });

  test('should auto-regenerate Tomorrow view when stale (older than 6 hours)', async ({ page }) => {
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 0, text: 'Fresh today' },
      tomorrow: { offset: 7 * 60 * 60 * 1000, text: 'Stale tomorrow text' },
      week: { offset: 0, text: 'Fresh week' },
    });

    await page.goto('/');

    // Navigate to NEXT 48H (tomorrow)
    await page.locator('.highlights-arrow[aria-label="Next"]').first().click();
    await expect(page.locator('.highlights-title').first()).toContainText('NEXT 48H');

    // Stale SSR data should be visible initially
    await expect(page.locator('.highlights-content').first()).toContainText('Stale tomorrow text');

    // Spinner should appear as client detects staleness
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin').first()).toBeVisible({ timeout: 10000 });

    // Wait for generation to complete
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin')).not.toBeVisible({ timeout: 60000 });

    // Content should be replaced with real generated text
    await expect(page.locator('.highlights-content').first()).not.toContainText('Stale tomorrow text');

    // Footer should show fresh timestamp
    await expect(page.locator('.highlights-footer').first()).toContainText('0 min ago');
  });

  test('should not regenerate This Week view when within 6 hour cooldown', async ({ page }) => {
    const user = await setupPageWithUser(page, { skipHighlights: true });
    seedHighlightsJobs(user.id, {
      today: { offset: 0, text: 'Fresh today' },
      tomorrow: { offset: 0, text: 'Fresh tomorrow' },
      week: { offset: 2 * 60 * 60 * 1000, text: 'Recent week content' },
    });

    await page.goto('/');

    // Navigate to This Week
    await page.locator('.highlights-arrow[aria-label="Next"]').first().click();
    await page.locator('.highlights-arrow[aria-label="Next"]').first().click();
    await expect(page.locator('.highlights-title').first()).toContainText('THIS WEEK');

    // Should show the seeded data
    await expect(page.locator('.highlights-content').first()).toContainText('Recent week content');
    await expect(page.locator('.highlights-footer').first()).toContainText('120 min ago');

    // Wait and verify no regeneration happens
    await page.waitForTimeout(2000);
    await expect(page.locator('.highlight-action-btn[title="Refresh"] .spin')).not.toBeVisible();

    // Content unchanged
    await expect(page.locator('.highlights-content').first()).toContainText('Recent week content');
  });
});
