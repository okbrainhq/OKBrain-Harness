import { test, expect } from '@playwright/test';
import { loadTestEnv, cleanupTestDb, setupPageWithUser, verifyTestDb, waitForChatCompletion } from './test-utils';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

loadTestEnv();

let cleanupDone = false;
test.beforeAll(async () => {
  if (!cleanupDone) {
    if (process.env.VERIFY_DB !== 'false') {
      verifyTestDb();
      process.env.VERIFY_DB = 'false';
    }
    cleanupDone = true;
  }
});

function seedConversationWithEvents(userId: string, messageCount: number) {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const conversationId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, title, grounding_enabled, response_mode, ai_provider, user_id, created_at, updated_at)
    VALUES (?, ?, 0, 'quick', 'xai', ?, ?, ?)
  `).run(conversationId, 'Scroll Test Chat', userId, now, now);

  let seq = 0;
  for (let i = 0; i < messageCount; i++) {
    seq++;
    db.prepare(`
      INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
      VALUES (?, ?, ?, 'user_message', ?, ?)
    `).run(uuidv4(), conversationId, seq, JSON.stringify({ text: `User message ${i + 1}` }), now);

    seq++;
    // Use long text to ensure scrollable content
    const longResponse = `This is assistant response number ${i + 1}. `.repeat(20);
    db.prepare(`
      INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
      VALUES (?, ?, ?, 'assistant_text', ?, ?)
    `).run(uuidv4(), conversationId, seq, JSON.stringify({ text: longResponse }), now);
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();

  return conversationId;
}

test.describe('Scroll Position Restore', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should save and restore chat scroll position via Open Last', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const conversationId = seedConversationWithEvents(user.id, 15);

    // Navigate to the chat
    await page.goto(`/chat/${conversationId}`);
    await page.waitForLoadState('networkidle');

    // Wait for messages to render
    const messages = page.locator('.message.user');
    await expect(messages.first()).toBeVisible({ timeout: 10000 });

    // Get the scrollable container
    const container = page.locator('.messages-container');

    // Scroll to a middle position
    await container.evaluate((el: HTMLElement) => {
      el.scrollTop = 500;
    });

    // Wait for debounced scroll save (300ms + buffer)
    await page.waitForTimeout(500);

    // Verify scroll position was saved
    const savedPos = await page.evaluate((convId: string) => {
      return localStorage.getItem(`scrollPos:chat:${convId}`);
    }, conversationId);
    expect(savedPos).toBeTruthy();
    expect(parseInt(savedPos!)).toBeGreaterThanOrEqual(400);

    // Navigate to home (new chat)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click "Open Last" button
    const openLastButton = page.locator('button:has-text("Open Last")');
    await expect(openLastButton).toBeVisible({ timeout: 10000 });
    await openLastButton.click();

    // Wait for chat page to load
    await expect(messages.first()).toBeVisible({ timeout: 10000 });

    // Wait for scroll restore (100ms setTimeout + buffer)
    await page.waitForTimeout(300);

    // Verify scroll position was restored
    const restoredScrollTop = await container.evaluate((el: HTMLElement) => el.scrollTop);
    expect(restoredScrollTop).toBeGreaterThanOrEqual(400);
  });

  test('should scroll streaming output toward viewport middle during streaming', async ({ page }) => {
    test.setTimeout(90000);

    const user = await setupPageWithUser(page);
    const conversationId = seedConversationWithEvents(user.id, 15);

    // Navigate to the chat (starts at top)
    await page.goto(`/chat/${conversationId}`);
    await page.waitForLoadState('networkidle');

    // Wait for messages to render
    const messages = page.locator('.message.user');
    await expect(messages.first()).toBeVisible({ timeout: 10000 });

    // Verify we're at the top
    const initialScrollTop = await page.locator('.messages-container').evaluate((el: HTMLElement) => el.scrollTop);
    expect(initialScrollTop).toBe(0);

    // Send a new message (will appear at the bottom, off-screen)
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Tell me something interesting');
    await input.press('Enter');

    // Wait for the response to complete
    await waitForChatCompletion(page, 60000);

    // The streaming scroll should have scrolled the container down from the top.
    // Without it, the new message and response would be below the fold (we started at scrollTop=0).
    const scrolledTop = await page.locator('.messages-container').evaluate((el: HTMLElement) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    // The new assistant response should be visible (scrolled into view)
    const lastAssistant = page.locator('.message.assistant').last();
    await expect(lastAssistant).toBeVisible();
  });

  test('should scroll to bottom with ?scroll=true fallback', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const conversationId = seedConversationWithEvents(user.id, 15);

    // Navigate directly with ?scroll=true
    await page.goto(`/chat/${conversationId}?scroll=true`);
    await page.waitForLoadState('networkidle');

    // Wait for messages to render
    const messages = page.locator('.message.user');
    await expect(messages.first()).toBeVisible({ timeout: 10000 });

    // Wait for scroll to bottom (100ms setTimeout + buffer)
    await page.waitForTimeout(300);

    // Verify we're scrolled near the bottom
    const { scrollTop, scrollHeight, clientHeight } = await page.locator('.messages-container').evaluate((el: HTMLElement) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    // scrollTop should be near (scrollHeight - clientHeight), i.e. close to the bottom
    const maxScroll = scrollHeight - clientHeight;
    expect(scrollTop).toBeGreaterThan(maxScroll - 50);
  });
});
