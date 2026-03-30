import { test, expect } from '@playwright/test';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { loadTestEnv, setupPageWithUser, waitForChatCompletion } from './test-utils';

loadTestEnv();

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  return new Database(dbPath);
}

function seedConversationWithShellCommand(userId: string) {
  const db = getDb();
  const conversationId = uuidv4();
  const callId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, title, user_id, ai_provider, response_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, 'Shell Command Test', userId, 'gemini', 'detailed', now, now);

  const insertEvent = db.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertEvent.run(`evt_${uuidv4()}`, conversationId, 1, 'user_message',
    JSON.stringify({ text: 'Run a shell command' }), now);

  const multiLineCommand = `echo "line1"\necho "line2"\necho "line3"\ncat /etc/hostname`;
  insertEvent.run(`evt_${uuidv4()}`, conversationId, 2, 'tool_call',
    JSON.stringify({
      tool_name: 'run_shell_command',
      arguments: { command: multiLineCommand },
      call_id: callId,
    }), now);

  insertEvent.run(`evt_${uuidv4()}`, conversationId, 3, 'tool_result',
    JSON.stringify({
      call_id: callId,
      status: 'success',
      stdout: 'line1\nline2\nline3\nmyhost\n',
      stderr: '',
      exit_code: 0,
      duration_ms: 42,
    }), now);

  insertEvent.run(`evt_${uuidv4()}`, conversationId, 4, 'assistant_text',
    JSON.stringify({ text: 'Done running the command.', model: 'Test Model' }), now);

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  return conversationId;
}

function seedConversationWithThoughts(userId: string, opts?: { extraAssistantText?: boolean }) {
  const db = getDb();
  const conversationId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, title, user_id, ai_provider, response_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, 'Thought Group Test', userId, 'gemini', 'detailed', now, now);

  const insertEvent = db.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // user_message
  insertEvent.run(`evt_${uuidv4()}`, conversationId, 1, 'user_message',
    JSON.stringify({ text: 'Hello' }), now);

  // 3 consecutive thought events
  insertEvent.run(`evt_${uuidv4()}`, conversationId, 2, 'thought',
    JSON.stringify({ text: 'First thought segment about the question.' }), now);
  insertEvent.run(`evt_${uuidv4()}`, conversationId, 3, 'thought',
    JSON.stringify({ text: 'Second thought continuing analysis.', duration: 3 }), now);
  insertEvent.run(`evt_${uuidv4()}`, conversationId, 4, 'thought',
    JSON.stringify({ text: 'Third and final thought before responding.', duration: 5 }), now);

  // assistant_text
  insertEvent.run(`evt_${uuidv4()}`, conversationId, 5, 'assistant_text',
    JSON.stringify({ text: 'Here is my response after thinking.', model: 'Test Model' }), now);

  if (opts?.extraAssistantText) {
    // Second round: user + thoughts + assistant
    insertEvent.run(`evt_${uuidv4()}`, conversationId, 6, 'user_message',
      JSON.stringify({ text: 'Follow up question' }), now);
    insertEvent.run(`evt_${uuidv4()}`, conversationId, 7, 'thought',
      JSON.stringify({ text: 'Thinking about follow up.' }), now);
    insertEvent.run(`evt_${uuidv4()}`, conversationId, 8, 'thought',
      JSON.stringify({ text: 'More follow up thoughts.', duration: 2 }), now);
    insertEvent.run(`evt_${uuidv4()}`, conversationId, 9, 'assistant_text',
      JSON.stringify({ text: 'Follow up response.', model: 'Test Model' }), now);
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  return conversationId;
}

function seedLongConversation(userId: string) {
  const db = getDb();
  const conversationId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, title, user_id, ai_provider, response_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, 'Long Conversation', userId, 'claude-haiku', 'detailed', now, now);

  const insertEvent = db.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let seq = 1;
  // Create 8 rounds of user + assistant to fill the viewport with lots of content
  for (let i = 1; i <= 8; i++) {
    insertEvent.run(`evt_${uuidv4()}`, conversationId, seq++, 'user_message',
      JSON.stringify({ text: `Question ${i}: Can you explain topic ${i} in detail? I need a thorough explanation.` }), now);

    const longText = `This is a detailed response for question ${i}. `.repeat(10)
      + `\n\nHere are the key points:\n- Point A for topic ${i}\n- Point B for topic ${i}\n- Point C for topic ${i}\n\n`
      + `In conclusion, topic ${i} is very important and requires careful consideration.`;

    insertEvent.run(`evt_${uuidv4()}`, conversationId, seq++, 'assistant_text',
      JSON.stringify({ text: longText, model: 'Claude Haiku' }), now);
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
  return conversationId;
}

function getChatEvents(conversationId: string): any[] {
  const db = getDb();
  db.pragma('wal_checkpoint(FULL)');
  const rows = db.prepare(`
    SELECT * FROM chat_events
    WHERE conversation_id = ?
    ORDER BY seq ASC
  `).all(conversationId);
  db.close();
  return rows;
}

test.describe('Chat Events UI', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('event-based rendering shows markdown', async ({ page }) => {
    test.setTimeout(120000);

    const user = await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message that will produce markdown in the response
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('Reply with exactly: **bold text** and a list:\n- item one\n- item two');
    await input.press('Enter');

    await waitForChatCompletion(page);

    // Verify the new event-based UI rendered the assistant message
    const assistantMessage = page.locator('.message.assistant');
    await expect(assistantMessage.first()).toBeVisible({ timeout: 10000 });

    // Should contain rendered markdown (content-styles class)
    const contentStyles = assistantMessage.locator('.content-styles').first();
    await expect(contentStyles).toBeVisible();

    // Verify the conversation has chat_events in the DB
    const url = page.url();
    const conversationId = url.split('/chat/')[1]?.split('?')[0];
    expect(conversationId).toBeTruthy();

    const events = getChatEvents(conversationId!);
    expect(events.length).toBeGreaterThanOrEqual(2); // at least user_message + assistant_text

    const assistantEvents = events.filter((e: any) => e.kind === 'assistant_text');
    expect(assistantEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('thought events render and collapse', async ({ page }) => {
    test.setTimeout(120000);

    const user = await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Enable thinking
    const thinkCheckbox = page.locator('.grounding-checkbox-primitive');
    const isChecked = await thinkCheckbox.locator('input[type="checkbox"]').isChecked();
    if (!isChecked) {
      await thinkCheckbox.click();
    }

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('What is 2+2? Reply briefly.');
    await input.press('Enter');

    await waitForChatCompletion(page);

    const url = page.url();
    const conversationId = url.split('/chat/')[1]?.split('?')[0];
    expect(conversationId).toBeTruthy();

    // Check if thought events exist in DB
    const events = getChatEvents(conversationId!);
    const thoughtEvents = events.filter((e: any) => e.kind === 'thought');

    // Thoughts depend on the model, they may or may not be present
    // If present, verify the UI renders them
    if (thoughtEvents.length > 0) {
      // Look for thought toggle button
      const thoughtButton = page.locator('.thoughts-container').first();
      await expect(thoughtButton).toBeVisible({ timeout: 10000 });

      // Click to expand
      await thoughtButton.locator('div').first().click();

      // Should show expanded content
      const expandedPanel = thoughtButton.locator('.content-styles');
      await expect(expandedPanel).toBeVisible();

      // Click again to collapse
      await thoughtButton.locator('div').first().click();
      await expect(expandedPanel).not.toBeVisible();
    }
  });

  test('tool call events render', async ({ page }) => {
    test.setTimeout(120000);

    const user = await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use Gemini for tool support
    await page.locator('#ai-provider').selectOption('gemini');

    const prompt = 'Find the current CPU usage of this server. Reply with just the result.';

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill(prompt);
    await input.press('Enter');

    // Wait for tool card to appear (rendered as a div, not a button)
    const toolCard = page.locator('div', { hasText: 'run_shell_command' }).first();
    await expect(toolCard).toBeVisible({ timeout: 60000 });

    await waitForChatCompletion(page);

    // Verify tool_call events in DB
    const url = page.url();
    const conversationId = url.split('/chat/')[1]?.split('?')[0];
    expect(conversationId).toBeTruthy();

    const events = getChatEvents(conversationId!);
    const toolCallEvents = events.filter((e: any) => e.kind === 'tool_call');
    expect(toolCallEvents.length).toBeGreaterThan(0);
  });

  test('consecutive thought events grouped on reload', async ({ page }) => {
    test.setTimeout(60000);

    const user = await setupPageWithUser(page);

    // Seed a conversation with 3 consecutive thought events directly in DB
    const conversationId = seedConversationWithThoughts(user.id, { extraAssistantText: true });

    // Navigate to the chat page (full server render)
    await page.goto(`/chat/${conversationId}`);
    await page.waitForLoadState('networkidle');

    // Should see exactly 2 thought containers (one per thought group),
    // NOT 5 (3 + 2 individual thoughts)
    const thoughtContainers = page.locator('.thoughts-container');
    await expect(thoughtContainers).toHaveCount(2, { timeout: 10000 });

    // Expand the first thought group
    await thoughtContainers.first().locator('div').first().click();
    const expandedPanel = thoughtContainers.first().locator('.content-styles');
    await expect(expandedPanel).toBeVisible();

    // Should contain text from all 3 thoughts combined
    const expandedText = await expandedPanel.textContent();
    expect(expandedText).toContain('First thought segment');
    expect(expandedText).toContain('Second thought continuing');
    expect(expandedText).toContain('Third and final thought');

    // Collapse it
    await thoughtContainers.first().locator('div').first().click();
    await expect(expandedPanel).not.toBeVisible();

    // Expand the second thought group
    await thoughtContainers.nth(1).locator('div').first().click();
    const expandedPanel2 = thoughtContainers.nth(1).locator('.content-styles');
    await expect(expandedPanel2).toBeVisible();

    const expandedText2 = await expandedPanel2.textContent();
    expect(expandedText2).toContain('Thinking about follow up');
    expect(expandedText2).toContain('More follow up thoughts');
  });

  test('thought grouping works after streaming completion', async ({ page }) => {
    test.setTimeout(120000);

    const user = await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Enable thinking
    const thinkCheckbox = page.locator('.grounding-checkbox-primitive');
    const isChecked = await thinkCheckbox.locator('input[type="checkbox"]').isChecked();
    if (!isChecked) {
      await thinkCheckbox.click();
    }

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('What is the capital of France? Reply in one word.');
    await input.press('Enter');

    await waitForChatCompletion(page);

    // Get conversation ID from URL
    const url = page.url();
    const conversationId = url.split('/chat/')[1]?.split('?')[0];
    expect(conversationId).toBeTruthy();

    // Check DB for thought events
    const events = getChatEvents(conversationId!);
    const thoughtEvents = events.filter((e: any) => e.kind === 'thought');

    if (thoughtEvents.length > 1) {
      // After streaming completes and redirect to EventChatView,
      // multiple thoughts should be grouped into one container
      // Reload to ensure clean EventChatView render
      await page.reload();
      await page.waitForLoadState('networkidle');

      const thoughtContainers = page.locator('.thoughts-container');
      await expect(thoughtContainers).toHaveCount(1, { timeout: 10000 });

      // Expand and verify combined content
      await thoughtContainers.first().locator('div').first().click();
      const expandedPanel = thoughtContainers.first().locator('.content-styles');
      await expect(expandedPanel).toBeVisible();

      // Should contain text from multiple thought events
      const expandedText = await expandedPanel.textContent();
      expect(expandedText!.length).toBeGreaterThan(10);
    } else if (thoughtEvents.length === 1) {
      // Single thought — just verify it renders
      await page.reload();
      await page.waitForLoadState('networkidle');

      const thoughtContainers = page.locator('.thoughts-container');
      await expect(thoughtContainers).toHaveCount(1, { timeout: 10000 });
    }
    // If no thought events, the model didn't think — skip (model dependent)
  });

  test('should auto-scroll during thoughts and stop at first output', async ({ page }) => {
    test.setTimeout(30000);

    const user = await setupPageWithUser(page);

    // Seed a conversation with lots of content so the page is scrollable
    const conversationId = seedLongConversation(user.id);

    // Navigate to the conversation (loads with event-based view, scrollable)
    await page.goto(`/chat/${conversationId}`);
    await page.waitForLoadState('networkidle');

    // Verify there's existing content and the page is scrollable
    const scrollInfo = await page.evaluate(() => {
      const container = document.querySelector('.messages-container');
      return {
        scrollHeight: container?.scrollHeight || 0,
        clientHeight: container?.clientHeight || 0,
      };
    });
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);

    // Verify we start at the top
    const initialScrollTop = await page.evaluate(() => {
      return document.querySelector('.messages-container')?.scrollTop || 0;
    });
    expect(initialScrollTop).toBeLessThan(100);

    // Mock /api/chat to return a fake job
    await page.route('/api/chat', async route => {
      await route.fulfill({
        json: { jobId: 'mock-autoscroll-job', conversationId }
      });
    });

    // Build SSE stream with thoughts followed by output
    await page.route('**/api/jobs/mock-autoscroll-job/stream**', async route => {
      const sseEvents = [
        { kind: 'output', payload: { type: 'init', conversationId } },
        // Multiple thoughts
        { kind: 'thought', payload: { text: 'Thinking step 1: analyzing the question...\n' } },
        { kind: 'thought', payload: { text: 'Thinking step 2: considering options...\n' } },
        { kind: 'thought', payload: { text: 'Thinking step 3: formulating response...\n' } },
        // Output starts
        { kind: 'output', payload: { text: 'UNIQUE_SCROLL_TEST_OUTPUT: Here is my response.' } },
        // Final
        { kind: 'output', payload: { final: true, messageId: 'mock-scroll-msg', model: 'Claude Haiku', thinkingDuration: 2 } },
        { done: true },
      ];

      const body = sseEvents.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body,
      });
    });

    // Send a new message from the existing conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Tell me something new');
    await input.press('Enter');

    // Wait for streaming to complete
    await expect(page.locator('.message.assistant.streaming')).toHaveCount(0, { timeout: 10000 });

    // Wait for scroll animations to settle
    await page.waitForTimeout(500);

    // Verify the page has scrolled down from the top
    // (auto-scroll during thoughts/output should have moved us down)
    const finalScrollTop = await page.evaluate(() => {
      return document.querySelector('.messages-container')?.scrollTop || 0;
    });
    expect(finalScrollTop).toBeGreaterThan(initialScrollTop + 100);

    // Verify the user's new message is visible (scrolled into view)
    const userMessage = page.locator('text=Tell me something new');
    await expect(userMessage).toBeVisible({ timeout: 3000 });
  });

  test('shell command show args toggle', async ({ page }) => {
    test.setTimeout(60000);

    const user = await setupPageWithUser(page);
    const conversationId = seedConversationWithShellCommand(user.id);

    await page.goto(`/chat/${conversationId}`);
    await page.waitForLoadState('networkidle');

    // The tool card should be visible
    const toolCard = page.locator('.tool-call-container').first();
    await expect(toolCard).toBeVisible({ timeout: 10000 });

    // Expand the card by clicking the header
    await toolCard.locator('button').first().click();

    // "Show Args" button should be visible in the toolbar
    const showArgsBtn = toolCard.getByText('Show Args');
    await expect(showArgsBtn).toBeVisible();

    // Args code block should NOT be visible yet
    const argsCode = toolCard.locator('pre');
    await expect(argsCode).not.toBeVisible();

    // Click "Show Args"
    await showArgsBtn.click();

    // Now args code should be visible with the full command
    await expect(argsCode).toBeVisible();
    await expect(argsCode).toContainText('echo "line1"');
    await expect(argsCode).toContainText('cat /etc/hostname');

    // Button text should change to "Hide Args"
    const hideArgsBtn = toolCard.getByText('Hide Args');
    await expect(hideArgsBtn).toBeVisible();

    // Click "Hide Args" to collapse
    await hideArgsBtn.click();
    await expect(argsCode).not.toBeVisible();

    // Button text reverts to "Show Args"
    await expect(showArgsBtn).toBeVisible();
  });
});
