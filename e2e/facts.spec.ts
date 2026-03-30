import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForChatCompletion } from './test-utils';
import * as path from 'path';

loadTestEnv();

// Seed chat messages directly in the database using chat_events
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

// Read facts from DB for a user
function getFactsFromDb(userId: string): Array<{ id: string; category: string; fact: string }> {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  db.pragma('wal_checkpoint(FULL)');

  const facts = db.prepare(
    'SELECT id, category, fact FROM facts WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);

  db.close();
  return facts as Array<{ id: string; category: string; fact: string }>;
}

// Seed facts directly in the database
function seedFacts(userId: string, facts: Array<{ category: string; fact: string }>) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const insertFact = db.prepare(`
    INSERT INTO facts (id, user_id, category, fact, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const f of facts) {
    insertFact.run(uuidv4(), userId, f.category, f.fact, new Date().toISOString());
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

// Seed facts + fact sheet directly (for tests that need facts in context without running extraction)
function seedFactsWithSheet(userId: string, facts: Array<{ category: string; fact: string }>) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const insertFact = db.prepare(`
    INSERT INTO facts (id, user_id, category, fact, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const factEntries: Array<{ category: string; fact: string }> = [];
  for (const f of facts) {
    insertFact.run(uuidv4(), userId, f.category, f.fact, new Date().toISOString());
    factEntries.push({ category: f.category, fact: f.fact });
  }

  // Also create a fact sheet so the chat worker can inject facts into context
  db.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, fact_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, JSON.stringify(factEntries), factEntries.length, new Date().toISOString());

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

test.describe('Fact Deletion', () => {
  test('should delete a fact from the /me page', async ({ page }) => {
    const user = await setupPageWithUser(page);

    // Seed some facts
    seedFacts(user.id, [
      { category: 'core', fact: 'Lives in Sri Lanka' },
      { category: 'technical', fact: 'Prefers TypeScript over JavaScript' },
      { category: 'project', fact: 'Building a knowledge app called Brain' },
    ]);

    // Navigate to /me and switch to Facts tab
    await page.goto('/me');
    await page.locator('.me-tab:has-text("Facts")').click();

    // Wait for facts to load
    await expect(page.locator('.me-fact-item')).toHaveCount(3);

    // Find the fact we want to delete
    const factToDelete = page.locator('.me-fact-item', { hasText: 'Prefers TypeScript over JavaScript' });
    await expect(factToDelete).toBeVisible();

    // Hover to reveal the delete button and click it
    await factToDelete.hover();
    page.once('dialog', dialog => dialog.accept());
    await factToDelete.locator('.me-fact-action-delete').click();

    // Verify the fact is removed from the UI
    await expect(page.locator('.me-fact-item')).toHaveCount(2);
    await expect(page.locator('.me-fact-item', { hasText: 'Prefers TypeScript over JavaScript' })).toHaveCount(0);

    // Verify remaining facts are still visible
    await expect(page.locator('.me-fact-item', { hasText: 'Lives in Sri Lanka' })).toBeVisible();
    await expect(page.locator('.me-fact-item', { hasText: 'Building a knowledge app called Brain' })).toBeVisible();

    // Verify it's also deleted from the database
    const remainingFacts = getFactsFromDb(user.id);
    expect(remainingFacts.length).toBe(2);
    expect(remainingFacts.find(f => f.fact === 'Prefers TypeScript over JavaScript')).toBeUndefined();
  });
});

test.describe('Fact Editing', () => {
  test('should edit a fact text from the /me page', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFacts(user.id, [
      { category: 'core', fact: 'Lives in Sri Lanka' },
      { category: 'technical', fact: 'Prefers TypeScript over JavaScript' },
    ]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Facts")').click();
    await expect(page.locator('.me-fact-item')).toHaveCount(2);

    // Hover and click edit on the first fact (most recent first)
    const factToEdit = page.locator('.me-fact-item', { hasText: 'Lives in Sri Lanka' });
    await factToEdit.hover();
    await factToEdit.locator('.me-fact-action-edit').click();

    // After clicking edit, the text moves into an input so hasText no longer matches.
    // Find the input within the fact list instead.
    const input = page.locator('.me-fact-edit-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Lives in Sri Lanka');

    // Clear and type new text, then press Enter to save
    await input.fill('Lives in Japan');
    const patchResponse = page.waitForResponse(resp => resp.url().includes('/api/facts') && resp.request().method() === 'PATCH');
    await page.keyboard.press('Enter');
    await patchResponse;

    // Verify the UI updated
    await expect(page.locator('.me-fact-item', { hasText: 'Lives in Japan' })).toBeVisible();
    await expect(page.locator('.me-fact-item', { hasText: 'Lives in Sri Lanka' })).toHaveCount(0);

    // Verify it's saved in the database
    const facts = getFactsFromDb(user.id);
    expect(facts.find(f => f.fact === 'Lives in Japan')).toBeDefined();
    expect(facts.find(f => f.fact === 'Lives in Sri Lanka')).toBeUndefined();
  });

  test('should change a fact category from the /me page', async ({ page }) => {
    const user = await setupPageWithUser(page);

    seedFacts(user.id, [
      { category: 'core', fact: 'Enjoys hiking on weekends' },
    ]);

    await page.goto('/me');
    await page.locator('.me-tab:has-text("Facts")').click();
    await expect(page.locator('.me-fact-item')).toHaveCount(1);

    // Verify initial category badge
    const factItem = page.locator('.me-fact-item').first();
    await expect(factItem.locator('.me-fact-badge')).toHaveText('core');

    // Enter edit mode
    await factItem.hover();
    await factItem.locator('.me-fact-action-edit').click();

    // Change category via the select dropdown
    const select = page.locator('.me-fact-category-select');
    await expect(select).toBeVisible();
    await select.selectOption('transient');

    // Save with the check button
    const patchResponse = page.waitForResponse(resp => resp.url().includes('/api/facts') && resp.request().method() === 'PATCH');
    await page.locator('.me-fact-action-save').click();
    await patchResponse;

    // Verify the badge updated in UI
    const updatedItem = page.locator('.me-fact-item', { hasText: 'Enjoys hiking on weekends' });
    await expect(updatedItem.locator('.me-fact-badge')).toHaveText('transient');

    // Verify it's saved in the database
    const facts = getFactsFromDb(user.id);
    const updated = facts.find(f => f.fact === 'Enjoys hiking on weekends');
    expect(updated).toBeDefined();
    expect(updated!.category).toBe('transient');
  });
});

// Count fact extractions (dedup references) for a user
function getFactExtractionCount(userId: string): number {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  db.pragma('wal_checkpoint(FULL)');

  const result = db.prepare(
    `SELECT COUNT(*) as count FROM fact_extractions fe
     JOIN facts f ON f.id = fe.fact_id
     WHERE f.user_id = ?`
  ).get(userId) as { count: number };

  db.close();
  return result.count;
}

test.describe('Fact Extraction', () => {
  test('should extract facts from seeded conversations', async ({ page, request }) => {
    // Ollama local models can be slower, allow extra time
    test.setTimeout(300_000);

    // 1. Setup user with seeded conversations containing personal info
    const user = await setupPageWithUser(page);

    // Generate a 200+ word assistant reply to exercise the truncation code path
    const longAssistantReply = Array.from({ length: 40 }, (_, i) =>
      `Sentence number ${i + 1} with some extra words to pad the length.`
    ).join(' '); // ~400 words

    seedChatMessages(user.id, [
      {
        messages: [
          { role: 'user', content: 'I am a software developer from Sri Lanka. I mainly use TypeScript and Next.js for my projects.' },
          { role: 'assistant', content: 'That sounds great! TypeScript and Next.js are excellent choices for web development.' },
          { role: 'user', content: 'Yes, I also prefer SQLite over PostgreSQL for my personal projects because of its simplicity.' },
          { role: 'assistant', content: 'SQLite is indeed a great choice for personal projects - simple and efficient.' },
        ],
      },
      {
        // Conversation with a long assistant reply (tests truncation)
        messages: [
          { role: 'user', content: 'I live in Tokyo and I program in Go for my backend services.' },
          { role: 'assistant', content: longAssistantReply },
        ],
      },
    ]);

    // 2. Trigger fact extraction via test API route
    const headers = { Cookie: `auth-token=${user.token}` };

    console.log('[TEST] Triggering fact extraction...');
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    console.log('[TEST] Fact extraction result:', extractResult);

    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    // 3. Verify facts were created in the database
    const facts = getFactsFromDb(user.id);
    console.log('[TEST] Extracted facts:', facts);

    // Should extract at least 2 facts across both conversations
    expect(facts.length).toBeGreaterThanOrEqual(2);

    // At least some recognizable content from the conversations
    const allFactTexts = facts.map(f => f.fact.toLowerCase()).join(' ');
    expect(allFactTexts).toMatch(/sri lanka|typescript|next\.?js|sqlite|go|tokyo/i);

    // 4. Verify fact_extractions were created
    const extractionCount = getFactExtractionCount(user.id);
    console.log('[TEST] Fact extractions:', extractionCount, 'for', facts.length, 'facts');
    expect(extractionCount).toBeGreaterThanOrEqual(facts.length);

    // 5. Verify facts are returned from the API
    const factsResponse = await request.get('http://localhost:3001/api/facts', { headers });
    const factsData = await factsResponse.json();

    expect(factsResponse.ok()).toBeTruthy();
    expect(factsData.facts.length).toBeGreaterThan(0);
    expect(factsData.facts[0]).toHaveProperty('extraction_count');

    // 6. Verify fact sheet was also generated
    const sheetResponse = await request.get('http://localhost:3001/api/fact-sheet', { headers });
    expect(sheetResponse.ok()).toBeTruthy();
    const sheetData = await sheetResponse.json();
    expect(sheetData).not.toBeNull();
    expect(sheetData.facts.length).toBeGreaterThan(0);
    console.log('[TEST] Fact sheet generated with', sheetData.fact_count, 'facts');
  });
});

test.describe('Fact Context Injection', () => {
  test('should inject facts into chat context', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Setup user and seed facts + fact sheet directly (no extraction needed)
    const user = await setupPageWithUser(page);

    seedFactsWithSheet(user.id, [
      { category: 'core', fact: 'Has a pet cat named Whiskers' },
      { category: 'technical', fact: 'Favorite programming language is Rust' },
    ]);

    // 2. Start a chat and ask the AI about something from the facts
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea[placeholder="Ask me anything..."]');
    await chatInput.waitFor({ state: 'visible', timeout: 30000 });

    await chatInput.fill('What do you know about my pet? Answer briefly.');
    await page.keyboard.press('Enter');

    // 3. Wait for the response
    await waitForChatCompletion(page);

    // 4. Check the AI response mentions the cat name from the facts
    const assistantMessages = page.locator('[class*="assistant"]');
    const responseText = await assistantMessages.last().textContent();
    console.log('[TEST] AI response:', responseText);

    expect(responseText?.toLowerCase()).toMatch(/whiskers|cat/);
  });
});
