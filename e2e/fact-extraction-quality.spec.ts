import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser } from './test-utils';
import * as path from 'path';

loadTestEnv();

function seedChatMessages(userId: string, conversations: Array<{
  title?: string;
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
    insertConv.run(conversationId, userId, conv.title || 'Test Conversation', now, now);

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

test.describe.skip('Fact Extraction Quality', () => {
  test.describe.configure({ mode: 'parallel' });

  test('should extract transient interest from a news/current-events conversation', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    // Real conversation: user asking about CEB strike in Sri Lanka
    seedChatMessages(user.id, [{
      title: 'CEB Strike Sri Lanka',
      messages: [
        { role: 'user', content: 'What happened to the CEB strike in Sri Lanka?' },
        { role: 'assistant', content: 'The Ceylon Electricity Board (CEB) has been officially dissolved as of March 9, 2026. The strike was employees protesting the restructuring. CEB was replaced by six state-owned successor companies.' },
        { role: 'user', content: 'Are they private companies?' },
        { role: 'assistant', content: 'No, they\'re state-owned. The six successor companies are publicly/state-owned entities, not private companies.' },
        { role: 'user', content: 'So, now government doesn\'t have to fund them right?' },
        { role: 'assistant', content: 'No, government still funds them. They\'re state-owned, so the restructuring doesn\'t eliminate funding needs.' },
        { role: 'user', content: 'Wouldn\'t it be too complicated now?' },
        { role: 'assistant', content: 'Actually, yes in the short term. 6 companies to coordinate vs 1 unified CEB. But the bet is long-term efficiency outweighs short-term chaos.' },
      ],
    }]);

    // Trigger extraction
    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    console.log('[TEST] Extraction result:', extractResult);
    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    const facts = getFactsFromDb(user.id);
    console.log('[TEST] Extracted facts:', facts);

    // Should extract at least one transient fact about CEB/Sri Lanka electricity
    expect(facts.length).toBeGreaterThanOrEqual(1);

    const allText = facts.map(f => `[${f.category}] ${f.fact}`).join('\n');
    console.log('[TEST] All facts:\n' + allText);

    // Should capture the topic of interest, not describe each question
    const hasTopicFact = facts.some(f =>
      /ceb|electricity|sri lanka.*restructur/i.test(f.fact)
    );
    expect(hasTopicFact).toBe(true);

    // Should NOT have "Asks about" / "Questions" / "Inquires about" phrasing
    const hasBadPhrasing = facts.some(f =>
      /^(asks about|questions|inquires about|wants to know)/i.test(f.fact)
    );
    expect(hasBadPhrasing).toBe(false);
  });

  test('should extract transient interest from a geopolitics conversation', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    // More sustained interest — 3 turns on the same topic
    seedChatMessages(user.id, [{
      title: 'Dubai Future After War',
      messages: [
        { role: 'user', content: 'Now since the war is past 7 days, what\'s going on in Dubai. What would be its future look like?' },
        { role: 'assistant', content: 'Dubai is facing significant uncertainty. The conflict has disrupted trade routes and tourism. However, Dubai\'s diversified economy provides some resilience.' },
        { role: 'user', content: 'What about the real estate market there? Will prices crash?' },
        { role: 'assistant', content: 'Real estate is likely to see a correction. Many foreign investors are holding off on purchases until the situation stabilizes.' },
        { role: 'user', content: 'I\'m particularly worried about Dubai\'s economy long term. Do you think it can recover?' },
        { role: 'assistant', content: 'Dubai has recovered from past crises. Its diversification strategy should help in the long run.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    console.log('[TEST] Extraction result:', extractResult);
    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    const facts = getFactsFromDb(user.id);
    console.log('[TEST] Extracted facts:', facts);

    // Should extract a transient fact about Dubai interest
    expect(facts.length).toBeGreaterThanOrEqual(1);

    const hasTopicFact = facts.some(f =>
      /dubai/i.test(f.fact)
    );
    expect(hasTopicFact).toBe(true);

    const hasBadPhrasing = facts.some(f =>
      /^(asks about|questions|inquires about|wants to know)/i.test(f.fact)
    );
    expect(hasBadPhrasing).toBe(false);
  });

  test('should NOT extract facts from generic greetings or simple commands', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    seedChatMessages(user.id, [{
      title: 'Generic Chat',
      messages: [
        { role: 'user', content: 'Hello, how are you today?' },
        { role: 'assistant', content: 'I\'m doing well, thanks for asking!' },
        { role: 'user', content: 'Summarize this article for me' },
        { role: 'assistant', content: 'Sure, please share the article.' },
        { role: 'user', content: 'What time is it?' },
        { role: 'assistant', content: 'I don\'t have access to the current time.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    const facts = getFactsFromDb(user.id);
    console.log('[TEST] Extracted facts (should be empty):', facts);

    // Should extract nothing from generic chit-chat
    expect(facts.length).toBe(0);
  });

  test('should extract core/technical facts from clear personal statements', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    seedChatMessages(user.id, [{
      title: 'Personal Info',
      messages: [
        { role: 'user', content: 'I live in Colombo and I\'ve been using Rust for my backend services for the past 2 years.' },
        { role: 'assistant', content: 'Rust is a great choice for backend development.' },
        { role: 'user', content: 'Yeah, I also switched from PostgreSQL to SQLite for my side projects. Much simpler to deploy.' },
        { role: 'assistant', content: 'SQLite is indeed simpler for smaller projects.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    const facts = getFactsFromDb(user.id);
    console.log('[TEST] Extracted facts:', facts);

    // Should extract multiple facts
    expect(facts.length).toBeGreaterThanOrEqual(2);

    const allText = facts.map(f => f.fact.toLowerCase()).join(' ');

    // Should capture location
    expect(allText).toMatch(/colombo/i);

    // Should capture at least one technical preference
    const hasTech = /rust|sqlite|postgresql/i.test(allText);
    expect(hasTech).toBe(true);
  });
});

// Seed a fact sheet directly in the database
function seedFactSheet(userId: string, facts: Array<{ category: string; fact: string }>, source: string = 'qwen') {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const entries = facts.map(f => ({ category: f.category, fact: f.fact }));
  db.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, fact_count, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, JSON.stringify(entries), entries.length, source, new Date().toISOString());

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

function getFactSheetFromDb(userId: string): Array<{ category: string; fact: string }> | null {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);
  db.pragma('wal_checkpoint(FULL)');

  const row = db.prepare(
    'SELECT facts_json FROM fact_sheets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId) as { facts_json: string } | undefined;

  db.close();
  return row ? JSON.parse(row.facts_json) : null;
}

test.describe.skip('Fact Merge Quality', () => {
  test.describe.configure({ mode: 'parallel' });

  test('should not add annotations like (High Priority) to merged facts', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    // Seed existing fact sheet with transient facts
    seedFactSheet(user.id, [
      { category: 'transient', fact: 'Interested in ThinkPad X1 Carbon' },
      { category: 'transient', fact: 'Tracking NVIDIA GPU prices' },
      { category: 'transient', fact: 'Looking into solar panels for home' },
      { category: 'core', fact: 'Lives in Sri Lanka' },
      { category: 'technical', fact: 'Uses TypeScript and Next.js' },
    ]);

    // New conversation that should add transient facts via merge
    seedChatMessages(user.id, [{
      title: 'CEB Discussion',
      messages: [
        { role: 'user', content: 'What happened to the CEB strike in Sri Lanka?' },
        { role: 'assistant', content: 'The CEB has been dissolved and replaced by six state-owned companies.' },
        { role: 'user', content: 'Are they private companies?' },
        { role: 'assistant', content: 'No, they are state-owned entities.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    console.log('[TEST] Merge test extraction result:', extractResult);
    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    const sheet = getFactSheetFromDb(user.id);
    console.log('[TEST] Merged fact sheet:', sheet);

    expect(sheet).not.toBeNull();
    expect(sheet!.length).toBeGreaterThan(0);

    // No fact should contain annotations like (High Priority), (Important), etc.
    const hasAnnotation = sheet!.some(f =>
      /\(high priority\)|\(important\)|\(low priority\)|\(new\)|\(updated\)/i.test(f.fact)
    );
    expect(hasAnnotation).toBe(false);
  });

  test('should produce a valid fact sheet after merge with no annotations', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    // Seed existing fact sheet with multiple categories
    seedFactSheet(user.id, [
      { category: 'core', fact: 'Lives in Colombo' },
      { category: 'core', fact: 'Has two children' },
      { category: 'technical', fact: 'Uses Python for data science' },
      { category: 'technical', fact: 'Prefers VS Code' },
      { category: 'transient', fact: 'Interested in electric vehicles' },
      { category: 'transient', fact: 'Tracking NVIDIA GPU prices' },
    ]);

    // New conversation adds facts across categories
    seedChatMessages(user.id, [{
      title: 'Personal + Tech Update',
      messages: [
        { role: 'user', content: 'I live in Colombo and I just started learning Rust. Also been reading about the Mars missions lately.' },
        { role: 'assistant', content: 'Rust is a great language! And the Mars missions are fascinating.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    expect(extractResponse.ok()).toBeTruthy();

    const sheet = getFactSheetFromDb(user.id);
    console.log('[TEST] Merged sheet:', sheet);

    expect(sheet).not.toBeNull();
    expect(sheet!.length).toBeGreaterThanOrEqual(1);

    // Every fact should be a plain string — no annotations
    for (const entry of sheet!) {
      expect(entry.fact).not.toMatch(/\(high priority\)|\(important\)|\(low priority\)|\(new\)|\(updated\)|\(merged\)/i);
      // Every fact should have a valid category
      expect(['core', 'technical', 'project', 'transient']).toContain(entry.category);
    }
  });
});
