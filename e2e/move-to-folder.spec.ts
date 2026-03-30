import { test, expect, request } from '@playwright/test';
import { loadTestEnv, verifyTestDb, setupPageWithUser } from './test-utils';
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

async function createApiContextForUser(token: string) {
  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: {
      'Cookie': `auth-token=${token}`,
    },
  });
  return context;
}

// Insert a chat event directly into the DB so the chat header (with menu) is visible
function insertChatEvent(conversationId: string) {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);
  const eventId = `evt_${uuidv4()}`;
  const content = JSON.stringify({ text: 'hello', model: 'test' });
  db.prepare(
    `INSERT INTO chat_events (id, conversation_id, seq, kind, content) VALUES (?, ?, 1, 'user_message', ?)`
  ).run(eventId, conversationId, content);
  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

test.describe('Move to Folder via Menu', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should move a conversation to a folder via the menu modal', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const context = await createApiContextForUser(user.token);

    // Create a folder and a conversation
    const folderRes = await context.post('/api/folders', { data: { name: 'Test Folder' } });
    const folder = await folderRes.json();

    const convRes = await context.post('/api/conversations', { data: { title: 'Move Me Chat' } });
    const conversation = await convRes.json();

    // Insert a message so the chat header shows
    insertChatEvent(conversation.id);

    // Navigate to the conversation
    await page.goto(`/chat/${conversation.id}`);
    await page.waitForLoadState('networkidle');

    // Open the triple dot menu
    const menuButton = page.locator('.chat-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();

    // Click "Move to Folder"
    const moveItem = page.locator('.chat-menu-item').filter({ hasText: 'Move' });
    await expect(moveItem).toBeVisible();
    await moveItem.click();

    // Modal should appear with the select
    const select = page.locator('#move-to-folder-select');
    await expect(select).toBeVisible({ timeout: 5000 });

    // Select the folder
    await select.selectOption(folder.id);

    // Click Move button
    const moveButton = page.locator('button').filter({ hasText: 'Move' }).last();
    await moveButton.click();

    // Verify via API that conversation is now in the folder
    const getRes = await context.get(`/api/conversations/${conversation.id}`);
    const updated = await getRes.json();
    expect(updated.folder_id).toBe(folder.id);
  });

  test('should move a document to a folder via the menu modal', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const context = await createApiContextForUser(user.token);

    // Create a folder and a document
    const folderRes = await context.post('/api/folders', { data: { name: 'Doc Folder' } });
    const folder = await folderRes.json();

    const docRes = await context.post('/api/docs', { data: { title: 'Move Me Doc' } });
    const doc = await docRes.json();

    // Navigate to the document
    await page.goto(`/doc/${doc.id}`);
    await page.waitForLoadState('networkidle');

    // Open the triple dot menu
    const menuButton = page.locator('.chat-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();

    // Click "Move to Folder"
    const moveItem = page.locator('.chat-menu-item').filter({ hasText: 'Move' });
    await expect(moveItem).toBeVisible();
    await moveItem.click();

    // Modal should appear with the select
    const select = page.locator('#move-to-folder-select');
    await expect(select).toBeVisible({ timeout: 5000 });

    // Select the folder
    await select.selectOption(folder.id);

    // Click Move button
    const moveButton = page.locator('button').filter({ hasText: 'Move' }).last();
    await moveButton.click();

    // Verify via API
    const getRes = await context.get(`/api/docs/${doc.id}`);
    const updated = await getRes.json();
    expect(updated.folder_id).toBe(folder.id);
  });

  test('should remove a conversation from a folder via the menu modal', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const context = await createApiContextForUser(user.token);

    // Create a folder and a conversation already in it
    const folderRes = await context.post('/api/folders', { data: { name: 'Remove From' } });
    const folder = await folderRes.json();

    const convRes = await context.post('/api/conversations', { data: { title: 'In Folder Chat' } });
    const conversation = await convRes.json();

    await context.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: folder.id },
    });

    // Insert a message so the chat header shows
    insertChatEvent(conversation.id);

    // Navigate to the conversation
    await page.goto(`/chat/${conversation.id}`);
    await page.waitForLoadState('networkidle');

    // Open menu and click Move to Folder
    const menuButton = page.locator('.chat-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();
    const moveItem = page.locator('.chat-menu-item').filter({ hasText: 'Move' });
    await moveItem.click();

    // The select should show the current folder pre-selected
    const select = page.locator('#move-to-folder-select');
    await expect(select).toBeVisible({ timeout: 5000 });
    await expect(select).toHaveValue(folder.id);

    // Select "No Folder" to remove from folder
    await select.selectOption('');

    // Click Move
    const moveButton = page.locator('button').filter({ hasText: 'Move' }).last();
    await moveButton.click();

    // Verify conversation is no longer in a folder
    const getRes = await context.get(`/api/conversations/${conversation.id}`);
    const updated = await getRes.json();
    expect(updated.folder_id).toBeNull();
  });

  test('should remove a document from a folder via the menu modal', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const context = await createApiContextForUser(user.token);

    // Create a folder and a document already in it
    const folderRes = await context.post('/api/folders', { data: { name: 'Doc Remove From' } });
    const folder = await folderRes.json();

    const docRes = await context.post('/api/docs', { data: { title: 'Doc In Folder' } });
    const doc = await docRes.json();

    await context.patch(`/api/docs/${doc.id}`, {
      data: { folder_id: folder.id },
    });

    // Navigate to the document
    await page.goto(`/doc/${doc.id}`);
    await page.waitForLoadState('networkidle');

    // Open menu and click Move
    const menuButton = page.locator('.chat-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();
    const moveItem = page.locator('.chat-menu-item').filter({ hasText: 'Move' });
    await moveItem.click();

    // The select should show the current folder pre-selected
    const select = page.locator('#move-to-folder-select');
    await expect(select).toBeVisible({ timeout: 5000 });
    await expect(select).toHaveValue(folder.id);

    // Select "No Folder" to remove from folder
    await select.selectOption('');

    // Click Move
    const moveButton = page.locator('button').filter({ hasText: 'Move' }).last();
    await moveButton.click();

    // Verify document is no longer in a folder
    const getRes = await context.get(`/api/docs/${doc.id}`);
    const updated = await getRes.json();
    expect(updated.folder_id).toBeNull();
  });

  test('should move a conversation to a different folder via the menu modal', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const context = await createApiContextForUser(user.token);

    // Create two folders and a conversation in the first one
    const folder1Res = await context.post('/api/folders', { data: { name: 'Folder A' } });
    const folder1 = await folder1Res.json();

    const folder2Res = await context.post('/api/folders', { data: { name: 'Folder B' } });
    const folder2 = await folder2Res.json();

    const convRes = await context.post('/api/conversations', { data: { title: 'Switch Folder Chat' } });
    const conversation = await convRes.json();

    await context.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: folder1.id },
    });

    // Insert a message so the chat header shows
    insertChatEvent(conversation.id);

    // Navigate to the conversation
    await page.goto(`/chat/${conversation.id}`);
    await page.waitForLoadState('networkidle');

    // Open menu and click Move
    const menuButton = page.locator('.chat-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();
    const moveItem = page.locator('.chat-menu-item').filter({ hasText: 'Move' });
    await moveItem.click();

    // The select should show folder1 pre-selected
    const select = page.locator('#move-to-folder-select');
    await expect(select).toBeVisible({ timeout: 5000 });
    await expect(select).toHaveValue(folder1.id);

    // Select folder2
    await select.selectOption(folder2.id);

    // Click Move
    const moveButton = page.locator('button').filter({ hasText: 'Move' }).last();
    await moveButton.click();

    // Verify conversation is now in folder2
    const getRes = await context.get(`/api/conversations/${conversation.id}`);
    const updated = await getRes.json();
    expect(updated.folder_id).toBe(folder2.id);
  });

  test('should move a document to a different folder via the menu modal', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const context = await createApiContextForUser(user.token);

    // Create two folders and a document in the first one
    const folder1Res = await context.post('/api/folders', { data: { name: 'Doc Folder A' } });
    const folder1 = await folder1Res.json();

    const folder2Res = await context.post('/api/folders', { data: { name: 'Doc Folder B' } });
    const folder2 = await folder2Res.json();

    const docRes = await context.post('/api/docs', { data: { title: 'Switch Folder Doc' } });
    const doc = await docRes.json();

    await context.patch(`/api/docs/${doc.id}`, {
      data: { folder_id: folder1.id },
    });

    // Navigate to the document
    await page.goto(`/doc/${doc.id}`);
    await page.waitForLoadState('networkidle');

    // Open menu and click Move
    const menuButton = page.locator('.chat-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();
    const moveItem = page.locator('.chat-menu-item').filter({ hasText: 'Move' });
    await moveItem.click();

    // The select should show folder1 pre-selected
    const select = page.locator('#move-to-folder-select');
    await expect(select).toBeVisible({ timeout: 5000 });
    await expect(select).toHaveValue(folder1.id);

    // Select folder2
    await select.selectOption(folder2.id);

    // Click Move
    const moveButton = page.locator('button').filter({ hasText: 'Move' }).last();
    await moveButton.click();

    // Verify document is now in folder2
    const getRes = await context.get(`/api/docs/${doc.id}`);
    const updated = await getRes.json();
    expect(updated.folder_id).toBe(folder2.id);
  });
});
