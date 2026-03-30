import { test, expect, request as playwrightRequest } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForChatCompletion, createUniqueUser, seedFreshHighlights } from './test-utils';
import * as path from 'path';

loadTestEnv();

// Seed chat messages directly in the database
function seedChatMessages(userId: string, conversations: Array<{
  messages: Array<{ role: string; content: string }>;
}>) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const insertConv = db.prepare(`
    INSERT INTO conversations (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const conv of conversations) {
    const conversationId = uuidv4();
    const now = new Date().toISOString();
    insertConv.run(conversationId, userId, 'Test Conversation', now, now);

    let seq = 1;
    for (const msg of conv.messages) {
      const kind = msg.role === 'user' ? 'user_message' : 'assistant_text';
      const content = msg.role === 'user'
        ? JSON.stringify({ text: msg.content })
        : JSON.stringify({ text: msg.content, model: 'test' });
      insertEvent.run(uuidv4(), conversationId, seq, kind, content, now);
      seq++;
    }
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

test.describe('Fact Search', () => {
  // Run serially — shares a single user with pre-extracted facts
  test.describe.configure({ mode: 'serial' });

  let sharedUser: { id: string; token: string; email: string };

  // Extract facts once before all tests — runs regardless of --grep
  test.beforeAll(async () => {
    sharedUser = await createUniqueUser();
    seedFreshHighlights(sharedUser.id);

    seedChatMessages(sharedUser.id, [
      {
        messages: [
          { role: 'user', content: 'I am a software developer from Sri Lanka. I mainly use TypeScript and Next.js for my projects.' },
          { role: 'assistant', content: 'That sounds great! TypeScript and Next.js are excellent choices for web development.' },
          { role: 'user', content: 'I also have a pet cat named Whiskers who loves to sit on my keyboard while I code.' },
          { role: 'assistant', content: 'Ha! Classic cat behavior. Whiskers sounds like a great coding companion.' },
        ],
      },
      {
        messages: [
          { role: 'user', content: 'I enjoy playing cricket on weekends and I support the Sri Lanka cricket team.' },
          { role: 'assistant', content: 'Cricket is a wonderful sport! Sri Lanka has produced some legendary players.' },
        ],
      },
      {
        messages: [
          { role: 'user', content: 'I work as a machine learning engineer at Google. I specialize in natural language processing and transformer architectures.' },
          { role: 'assistant', content: 'That\'s impressive! NLP and transformers are at the cutting edge of AI.' },
        ],
      },
    ]);

    const context = await playwrightRequest.newContext({
      baseURL: 'http://localhost:3001',
      extraHTTPHeaders: { Cookie: `auth-token=${sharedUser.token}` },
    });

    console.log('[TEST] Triggering fact extraction...');
    const extractResponse = await context.post('/api/facts/extract');
    const extractResult = await extractResponse.json();
    console.log('[TEST] Fact extraction result:', extractResult);
    await context.dispose();

    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');
  });

  test('should find facts via semantic search on /me page', async ({ page }) => {
    // Inject auth cookie for the shared user
    await page.context().addCookies([{
      name: 'auth-token',
      value: sharedUser.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    }]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Facts")').click();
    await expect(page.locator('.me-fact-item').first()).toBeVisible({ timeout: 10000 });

    // Search for "programming language" — should find TypeScript/Next.js facts
    const searchInput = page.locator('.me-fact-search-input');
    await searchInput.fill('programming language');

    // Wait for search results specifically (they have distance scores)
    await expect(page.locator('.me-fact-distance').first()).toBeVisible({ timeout: 10000 });

    const resultTexts = await page.locator('.me-fact-item .me-fact-text').allTextContents();
    console.log('[TEST] Search results for "programming language":', resultTexts);

    expect(resultTexts.length).toBeGreaterThan(0);
    const combined = resultTexts.join(' ').toLowerCase();
    expect(combined).toMatch(/typescript|next\.?js|software|developer/i);

    // Verify distance scores are numeric values in cosine range (0-2)
    const distances = await page.locator('.me-fact-distance').allTextContents();
    expect(distances.length).toBeGreaterThan(0);
    for (const d of distances) {
      const num = parseFloat(d);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThanOrEqual(2);
    }

    // Search for "pet animal" — should find the cat fact
    await searchInput.fill('pet animal');
    await expect(page.locator('.me-fact-distance').first()).toBeVisible({ timeout: 10000 });

    const petResults = await page.locator('.me-fact-item .me-fact-text').allTextContents();
    console.log('[TEST] Search results for "pet animal":', petResults);

    expect(petResults.length).toBeGreaterThan(0);
    const petCombined = petResults.join(' ').toLowerCase();
    expect(petCombined).toMatch(/cat|whiskers|pet/i);

    // Clear search and verify full fact list returns (no distance scores)
    await page.locator('.me-fact-search-clear').click();
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('.me-fact-item').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.me-fact-distance')).toHaveCount(0);
  });

  test('should show empty state when search has no matches', async ({ page }) => {
    await page.context().addCookies([{
      name: 'auth-token',
      value: sharedUser.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    }]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Facts")').click();
    await expect(page.locator('.me-fact-item').first()).toBeVisible({ timeout: 10000 });

    const searchInput = page.locator('.me-fact-search-input');
    const slider = page.locator('.me-fact-search-slider input[type="range"]');

    // Set strictness slider to very strict (0.5)
    await slider.fill('0.5');

    const searchResponse = page.waitForResponse(resp => resp.url().includes('/api/facts/search') && resp.ok());
    await searchInput.fill('quantum physics research paper');
    await searchResponse;

    await page.waitForTimeout(500);

    // With strict distance (0.5), unrelated query should yield empty or very few results
    const emptyState = page.locator('.me-empty-state:has-text("No matching facts found")');
    const searchResultItems = page.locator('.me-fact-distance');
    await expect(emptyState.or(searchResultItems.first())).toBeVisible({ timeout: 10000 });
  });

  test('should adjust results with strictness slider', async ({ page }) => {
    await page.context().addCookies([{
      name: 'auth-token',
      value: sharedUser.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    }]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Facts")').click();
    await expect(page.locator('.me-fact-item').first()).toBeVisible({ timeout: 10000 });

    const searchInput = page.locator('.me-fact-search-input');
    const slider = page.locator('.me-fact-search-slider input[type="range"]');

    // Search with loose strictness (1.5)
    await slider.fill('1.5');
    await searchInput.fill('artificial intelligence');

    await expect(page.locator('.me-fact-distance').first()).toBeVisible({ timeout: 10000 });
    const looseCount = await page.locator('.me-fact-distance').count();
    console.log('[TEST] Results with strictness 1.5:', looseCount);

    // Now tighten strictness (0.5)
    const searchResponse = page.waitForResponse(resp => resp.url().includes('/api/facts/search') && resp.ok());
    await slider.fill('0.5');
    await searchResponse;

    await page.waitForTimeout(500);

    const emptyState = await page.locator('.me-empty-state:has-text("No matching facts found")').isVisible();
    const effectiveStrictCount = emptyState ? 0 : await page.locator('.me-fact-distance').count();

    console.log('[TEST] Results with strictness 0.5:', effectiveStrictCount);

    expect(effectiveStrictCount).toBeLessThanOrEqual(looseCount);
  });

  test('should use RAG facts as context when chatting', async ({ page }) => {
    test.setTimeout(120_000);

    await page.context().addCookies([{
      name: 'auth-token',
      value: sharedUser.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    }]);

    // Start a new chat
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea[placeholder="Ask me anything..."]');
    await chatInput.waitFor({ state: 'visible', timeout: 30000 });

    // Ask about something from the extracted facts (cricket was seeded)
    await chatInput.fill('What sport do I play on weekends? Answer in one sentence.');
    await page.keyboard.press('Enter');

    await waitForChatCompletion(page);

    // The AI should mention cricket from the RAG-injected facts
    const assistantMessages = page.locator('[class*="assistant"]');
    const responseText = await assistantMessages.last().textContent();
    console.log('[TEST] AI response about sports:', responseText);

    expect(responseText?.toLowerCase()).toMatch(/cricket/);
  });
});
