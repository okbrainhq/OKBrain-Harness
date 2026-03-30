import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForChatCompletion } from './test-utils';
import * as path from 'path';

loadTestEnv();

// Seed conversations with titles and user messages
function seedConversationsWithMessages(
  userId: string,
  conversations: Array<{
    title: string;
    messages: Array<{ role: string; content: string }>;
    updatedAt?: string;
  }>
) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const insertConv = db.prepare(`
    INSERT INTO conversations (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const conv of conversations) {
    const conversationId = uuidv4();
    const now = conv.updatedAt || new Date().toISOString();
    insertConv.run(conversationId, userId, conv.title, now, now);

    for (const msg of conv.messages) {
      insertMsg.run(uuidv4(), conversationId, msg.role, msg.content, now);
    }
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

// Seed a fact sheet with a specific created_at timestamp
function seedFactSheet(userId: string, createdAt: string) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  db.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, fact_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, JSON.stringify([{ category: 'core', fact: 'placeholder' }]), 1, createdAt);

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

test.describe('Recent Conversations Context', () => {
  test.describe.configure({ mode: 'serial' });

  test('should inject recent conversations into chat context when no fact sheet exists', async ({ page }) => {
    test.setTimeout(120_000);

    const user = await setupPageWithUser(page);

    // Seed conversations with distinctive topics
    seedConversationsWithMessages(user.id, [
      {
        title: 'Quantum Computing Discussion',
        messages: [
          { role: 'user', content: 'I have been reading about quantum computing and qubits lately.' },
          { role: 'assistant', content: 'Quantum computing is a fascinating field!' },
        ],
      },
      {
        title: 'Sourdough Bread Baking',
        messages: [
          { role: 'user', content: 'I started making sourdough bread with a starter I named Bubbles.' },
          { role: 'assistant', content: 'Sourdough baking is a great hobby!' },
        ],
      },
    ]);

    // Start a new chat and ask about recent conversations
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea[placeholder="Ask me anything..."]');
    await chatInput.waitFor({ state: 'visible', timeout: 30000 });

    await chatInput.fill('Based on context you have, what topics have I been discussing recently? Answer briefly.');
    await page.keyboard.press('Enter');

    await waitForChatCompletion(page);

    const assistantMessages = page.locator('[class*="assistant"]');
    const responseText = await assistantMessages.last().textContent();
    console.log('[TEST] AI response:', responseText);

    // The AI should reference at least one of the seeded topics
    expect(responseText?.toLowerCase()).toMatch(/quantum|sourdough|bread|qubits|bubbles/);
  });

  test('should only inject conversations after last fact sheet generation', async ({ page }) => {
    test.setTimeout(120_000);

    const user = await setupPageWithUser(page);

    // Seed an OLD conversation (before fact sheet)
    const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    seedConversationsWithMessages(user.id, [
      {
        title: 'Old Gardening Chat',
        messages: [
          { role: 'user', content: 'I have been growing rare orchids in my greenhouse.' },
          { role: 'assistant', content: 'Orchids are beautiful flowers!' },
        ],
        updatedAt: pastDate,
      },
    ]);

    // Seed a fact sheet AFTER the old conversation
    const factSheetDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
    seedFactSheet(user.id, factSheetDate);

    // Seed a NEW conversation (after fact sheet)
    const recentDate = new Date().toISOString();
    seedConversationsWithMessages(user.id, [
      {
        title: 'Rock Climbing Adventures',
        messages: [
          { role: 'user', content: 'I just started indoor rock climbing at a gym called CruxWall.' },
          { role: 'assistant', content: 'Rock climbing is a great workout!' },
        ],
        updatedAt: recentDate,
      },
    ]);

    // Start a new chat
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chatInput = page.locator('textarea[placeholder="Ask me anything..."]');
    await chatInput.waitFor({ state: 'visible', timeout: 30000 });

    await chatInput.fill('What topics have I been discussing recently? Only mention topics you see in context. Answer briefly.');
    await page.keyboard.press('Enter');

    await waitForChatCompletion(page);

    const assistantMessages = page.locator('[class*="assistant"]');
    const responseText = await assistantMessages.last().textContent();
    console.log('[TEST] AI response:', responseText);

    // Should mention the post-fact-sheet topic
    expect(responseText?.toLowerCase()).toMatch(/rock climbing|cruxwall|climbing/);
    // Should NOT mention the pre-fact-sheet topic (orchids/greenhouse)
    expect(responseText?.toLowerCase()).not.toMatch(/orchid|greenhouse/);
  });
});
