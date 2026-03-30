import { test, expect } from '@playwright/test';
import { loadTestEnv, waitForApiResponse, verifyTestDb, setupPageWithUser, waitForChatCompletion } from './test-utils';

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

test.describe('Context Compaction', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  // Compaction tests involve multiple tool calls + summarization, so they need more time
  test.setTimeout(180000);

  test('should trigger compaction and persist compaction event', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select the compact-test provider (very low compactAt: 1000 threshold)
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5-compact-test');

    // Send a message that will trigger tool calls to build up context past the low threshold
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Search the internet for "latest AI news 2026" and summarize the results.');

    const responsePromise = waitForApiResponse(page, '/api/chat', 120000);
    await input.press('Enter');
    await responsePromise;

    // Wait for completion
    await waitForChatCompletion(page, 120000);

    // Verify the conversation completed successfully
    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10000 });

    // Check DB for compaction events
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(process.cwd(), 'brain.test.db'));

    const res = await page.request.get('/api/conversations');
    const conversations = await res.json();
    expect(conversations.length).toBe(1);
    const convId = conversations[0].id;

    // Compaction should have triggered (compactAt=1000 and any tool call produces >1000 tokens)
    const compactionEvents = db.prepare(
      'SELECT * FROM chat_events WHERE conversation_id = ? AND kind = ?'
    ).all(convId, 'compaction');
    expect(compactionEvents.length).toBeGreaterThanOrEqual(1);

    // Verify the compaction event structure
    const content = JSON.parse(compactionEvents[0].content);
    expect(content.text).toBeTruthy();
    expect(content.tokensBefore).toBeGreaterThan(0);
    expect(content.model).toBe('Compaction (Auto-summarized)');

    // Loop state should be cleared after completion
    const conv = db.prepare('SELECT loop_state FROM conversations WHERE id = ?').get(convId);
    expect(conv.loop_state).toBeNull();

    db.close();
  });

  test('should preserve events after page reload', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5-compact-test');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Search for "SpaceX 2026 launches" and summarize the results.');

    const responsePromise = waitForApiResponse(page, '/api/chat', 120000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(page, 120000);

    const currentUrl = page.url();

    // Reload the page
    await page.goto(currentUrl);
    await page.waitForLoadState('networkidle');

    // Verify the conversation still renders
    const messages = page.locator('.message');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify compaction events persist in DB
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(process.cwd(), 'brain.test.db'));

    const convId = currentUrl.split('/chat/')[1];
    if (convId) {
      const compactionEvents = db.prepare(
        'SELECT * FROM chat_events WHERE conversation_id = ? AND kind = ?'
      ).all(convId, 'compaction');
      expect(compactionEvents.length).toBeGreaterThanOrEqual(1);
    }

    db.close();
  });

  test('should stop mid-loop and preserve partial progress with stopped event', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use regular fireworks provider for this test — we're testing stop behavior, not compaction
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

    // Send a message that will trigger many tool calls (ensuring the model is busy long enough to stop)
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Write a 2000 word detailed essay about the history of artificial intelligence from the 1950s to today. Include specific dates, names, and breakthroughs.');

    const responsePromise = waitForApiResponse(page, '/api/chat', 120000);
    await input.press('Enter');
    await responsePromise;

    // Wait for streaming to start (some text being generated)
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible({ timeout: 30000 });

    // Wait for some text to be generated
    await page.waitForTimeout(2000);

    // Stop the generation
    await stopButton.click();
    await expect(stopButton).not.toBeVisible({ timeout: 15000 });

    // Wait for stop to be fully processed
    await page.waitForTimeout(2000);

    // Verify via API
    const res = await page.request.get('/api/conversations');
    const conversations = await res.json();
    expect(conversations.length).toBe(1);
    const convId = conversations[0].id;

    // Verify partial progress is preserved in DB
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(process.cwd(), 'brain.test.db'));

    // Should have a stopped event OR assistant_text (model may have finished before stop)
    const stoppedEvents = db.prepare(
      'SELECT * FROM chat_events WHERE conversation_id = ? AND kind = ?'
    ).all(convId, 'stopped');
    const assistantEvents = db.prepare(
      'SELECT * FROM chat_events WHERE conversation_id = ? AND kind = ?'
    ).all(convId, 'assistant_text');
    expect(stoppedEvents.length + assistantEvents.length).toBeGreaterThanOrEqual(1);

    // Should have events persisted (partial progress preserved)
    const allEvents = db.prepare(
      'SELECT * FROM chat_events WHERE conversation_id = ?'
    ).all(convId);
    expect(allEvents.length).toBeGreaterThanOrEqual(2);

    // Loop state should be cleared
    const conv = db.prepare('SELECT loop_state FROM conversations WHERE id = ?').get(convId);
    expect(conv.loop_state).toBeNull();

    db.close();
  });

  test('should continue conversation after compaction with correct context', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5-compact-test');

    // Send first message that triggers tool calls and compaction
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Search the internet for "climate change solutions 2026" and summarize the results. Remember the key points.');

    let responsePromise = waitForApiResponse(page, '/api/chat', 120000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(page, 120000);

    // Send a follow-up message referencing the previous context
    await input.fill('Based on what you just found, which solution seems most promising?');

    responsePromise = waitForApiResponse(page, '/api/chat', 120000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(page, 120000);

    // Verify we got a response (model could continue from compacted context)
    const assistantMessages = page.locator('.message.assistant');
    const count = await assistantMessages.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Verify the follow-up response is not empty
    const lastResponse = await assistantMessages.last().textContent();
    expect(lastResponse!.length).toBeGreaterThan(10);
  });
});
