import { test, expect } from '@playwright/test';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createUniqueUser, clickNewDoc, loadTestEnv, setupPageWithUser, waitForApiResponse, waitForChatCompletion } from './test-utils';

loadTestEnv();

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  return new Database(dbPath);
}

function seedSharedConversationWithYieldNotes(userId: string) {
  const db = getDb();
  const conversationId = uuidv4();
  const sharedLinkId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, title, user_id, ai_provider, response_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, 'Yield Share Test', userId, 'gemini', 'detailed', now, now);

  const insertEvent = db.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertEvent.run(
    `evt_${uuidv4()}`,
    conversationId,
    1,
    'user_message',
    JSON.stringify({ text: 'Show me the final answer.' }),
    now
  );

  insertEvent.run(
    `evt_${uuidv4()}`,
    conversationId,
    2,
    'assistant_text',
    JSON.stringify({
      text: 'Before yield\n\n<yeild>Waiting for shell command to finish.</yeild>\n\nAfter yield',
      model: 'Test Model',
    }),
    now
  );

  db.prepare(`
    INSERT INTO shared_links (id, type, resource_id, user_id, created_at)
    VALUES (?, 'conversation', ?, ?, ?)
  `).run(sharedLinkId, conversationId, userId, now);

  db.pragma('wal_checkpoint(FULL)');
  db.close();

  return { conversationId, sharedLinkId };
}

test.describe('Public Sharing', () => {
  test('should hide yield notes on a shared conversation and keep a line break', async ({ page }) => {
    const user = await createUniqueUser();
    const { sharedLinkId } = seedSharedConversationWithYieldNotes(user.id);

    await page.goto(`/s/${sharedLinkId}`);

    const assistantText = page.locator('.message.assistant .message-text').first();
    await expect(assistantText).toBeVisible();
    await expect(assistantText).not.toContainText('Waiting for shell command to finish.');

    const renderedText = await assistantText.evaluate((node) => (node as HTMLElement).innerText);
    expect(renderedText).toMatch(/Before yield\s*\n\s*After yield/);
  });

  test('should share a conversation', async ({ page, browser }) => {
    // 1. Create a conversation
    await setupPageWithUser(page);
    await page.goto('/');
    const chatInput = page.getByPlaceholder(/Ask me anything/i);
    await chatInput.fill('Hello for sharing');
    await chatInput.press('Enter');

    // Wait for response
    await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 20000 });

    // 2. Open Share Modal
    await page.getByLabel('More options').click();
    await page.getByText('Share', { exact: true }).click();

    // 3. Generate link
    await expect(page.getByText('Share Publicly')).toBeVisible();
    await page.locator('#generate-share-link').click();

    // 4. Get the link
    const linkElement = page.locator('#share-url-text');
    await expect(linkElement).toBeVisible();
    const publicUrl = await linkElement.innerText();
    expect(publicUrl).toContain('/s/');

    // 5. Open public link in a new context (to simulate a different user)
    // We use browser.newContext() to ensure no session/cookies are shared
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(publicUrl);

    // 6. Verify content
    await expect(newPage.locator('h1')).toBeVisible();
    await expect(newPage.locator('.message.user')).toContainText('Hello for sharing');
    await expect(newPage.locator('.message.assistant')).toBeVisible();

    // Verify no private elements
    await expect(newPage.locator('.sidebar')).not.toBeVisible();
    await expect(newPage.getByPlaceholder(/Ask me anything/i)).not.toBeVisible();

    await newContext.close();
  });

  test('should share a document', async ({ page, browser }) => {
    // 1. Create a document
    await setupPageWithUser(page);
    await page.goto('/');
    // Click 'Doc' button in sidebar
    await clickNewDoc(page);

    // Wait for document page to load
    await page.waitForURL(/\/doc\//);

    const titleInput = page.getByPlaceholder(/Untitled Document/i);
    await titleInput.fill('Public Doc Test');
    await titleInput.blur();

    // The editor content is in .tiptap
    const editor = page.locator('.tiptap');
    await editor.click();
    await page.keyboard.type('This is public content');

    // Wait for save
    await page.waitForTimeout(2000);

    // 2. Open Share Modal (from triple-dot menu)
    await page.getByLabel('More options').click();
    await page.getByText('Share', { exact: true }).click();

    // 3. Generate link
    await page.locator('#generate-share-link').click();

    // 4. Get the link
    const linkElement = page.locator('#share-url-text');
    await expect(linkElement).toBeVisible();
    const publicUrl = await linkElement.innerText();

    // 5. Open public link
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(publicUrl);

    // 6. Verify
    await expect(newPage.locator('h1')).toHaveText('Public Doc Test');
    await expect(newPage.locator('.tiptap')).toContainText('This is public content');

    // Verify read-only
    const tiptap = newPage.locator('.tiptap');
    await expect(tiptap).toHaveAttribute('contenteditable', 'false');

    await newContext.close();
  });

  test('should start a chat from a shared document', async ({ page, browser }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//);

    const titleInput = page.getByPlaceholder(/Untitled Document/i);
    await titleInput.fill('Shared Ask Document');
    await titleInput.blur();

    const keyword = `ShareKeyword-${Date.now()}`;
    const editor = page.locator('.tiptap');
    await editor.click();
    await page.keyboard.type(`This shared document contains ${keyword}.`);
    await page.waitForTimeout(2000);

    await page.getByLabel('More options').click();
    await page.getByText('Share', { exact: true }).click();
    await page.locator('#generate-share-link').click();
    const publicUrl = await page.locator('#share-url-text').innerText();

    const userBContext = await browser.newContext();
    const userBPage = await userBContext.newPage();
    await setupPageWithUser(userBPage);
    await userBPage.goto(publicUrl);

    await expect(userBPage.locator('h1')).toHaveText('Shared Ask Document');
    await expect(userBPage.locator('.tiptap')).toContainText(keyword);
    const sharedAskButton = userBPage.getByRole('button', { name: 'Ask', exact: true });
    await expect(sharedAskButton).toBeVisible();
    await sharedAskButton.click();

    await expect(userBPage).toHaveURL(/\/\?sharedLinkId=/);
    await expect(userBPage.locator('.messages-wrapper')).toContainText('Shared Content');
    await expect(userBPage.locator('.messages-wrapper')).toContainText('Shared Ask Document');

    const input = userBPage.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What keyword appears in this shared document?');
    const responsePromise = waitForApiResponse(userBPage, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(userBPage);

    const assistantMessages = userBPage.locator('.message.assistant');
    await expect(assistantMessages.last()).toContainText(keyword, { timeout: 30000 });

    // 7. Reload the page and verify the shared content link persists
    await userBPage.reload();
    await expect(userBPage.locator('.messages-wrapper')).toContainText('Shared Content');
    await expect(userBPage.locator('.messages-wrapper')).toContainText('Shared Ask Document');

    // 8. Share this second conversation and verify linked shared content shows on the public page
    await userBPage.getByLabel('More options').click();
    await userBPage.getByText('Share', { exact: true }).click();
    await expect(userBPage.getByText('Share Publicly')).toBeVisible();
    await userBPage.locator('#generate-share-link').click();
    const secondPublicUrl = await userBPage.locator('#share-url-text').innerText();

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(secondPublicUrl);

    // Verify the linked shared content card appears on the public shared page
    await expect(publicPage.locator('.document-context-card')).toBeVisible({ timeout: 10000 });
    await expect(publicPage.locator('.document-context-card')).toContainText('Shared Ask Document');

    await publicContext.close();
    await userBContext.close();
  });

  test('should start a chat from a shared conversation', async ({ page, browser }) => {
    await setupPageWithUser(page);
    await page.goto('/');

    const chatInput = page.getByPlaceholder(/Ask me anything/i);
    await chatInput.fill('Tell me about photosynthesis');
    const firstResponsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await chatInput.press('Enter');
    await firstResponsePromise;
    await waitForChatCompletion(page);

    await page.getByLabel('More options').click();
    await page.getByText('Share', { exact: true }).click();
    await expect(page.getByText('Share Publicly')).toBeVisible();
    await page.locator('#generate-share-link').click();
    const publicUrl = await page.locator('#share-url-text').innerText();

    const userBContext = await browser.newContext();
    const userBPage = await userBContext.newPage();
    await setupPageWithUser(userBPage);
    await userBPage.goto(publicUrl);

    await expect(userBPage.locator('h1')).toBeVisible();
    await expect(userBPage.locator('.message.user')).toContainText('Tell me about photosynthesis');
    await expect(userBPage.locator('.message.assistant')).toBeVisible();

    const sharedAskButton = userBPage.getByRole('button', { name: 'Ask', exact: true });
    await expect(sharedAskButton).toBeVisible();
    await sharedAskButton.click();

    await expect(userBPage).toHaveURL(/\/\?sharedLinkId=/);
    await expect(userBPage.locator('.messages-wrapper')).toContainText('Shared Content');

    const input = userBPage.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Summarize the conversation above');
    const responsePromise = waitForApiResponse(userBPage, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(userBPage);
    await expect(userBPage.locator('.message.assistant').last()).toBeVisible({ timeout: 30000 });

    // 7. Reload and verify the shared content link persists
    await userBPage.reload();
    await expect(userBPage.locator('.messages-wrapper')).toContainText('Shared Content');

    // 8. Share this second conversation and verify linked shared content on public page
    await userBPage.getByLabel('More options').click();
    await userBPage.getByText('Share', { exact: true }).click();
    await expect(userBPage.getByText('Share Publicly')).toBeVisible();
    await userBPage.locator('#generate-share-link').click();
    const secondPublicUrl = await userBPage.locator('#share-url-text').innerText();

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(secondPublicUrl);

    // Verify the linked shared content card appears on the public shared page
    await expect(publicPage.locator('.document-context-card')).toBeVisible({ timeout: 10000 });

    await publicContext.close();
    await userBContext.close();
  });
});
