import { test, expect, request } from '@playwright/test';
import { loadTestEnv, waitForApiResponse, verifyTestDb, setupPageWithUser, createUniqueUser } from './test-utils';

// Load test environment before tests
loadTestEnv();

// Run cleanup once per worker (not per test)
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

// Helper to create authenticated request context for API tests
async function createAuthContext() {
  const user = await createUniqueUser();
  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: {
      'Cookie': `auth-token=${user.token}`,
    },
  });
  return { context, user };
}

// Helper to create API context that uses the same user as the page
async function createApiContextForUser(token: string) {
  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: {
      'Cookie': `auth-token=${token}`,
    },
  });
  return context;
}

test.describe('Folders Feature', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should display New Folder button in sidebar', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if New Folder button is visible (now just an icon button)
    const newFolderBtn = page.locator('.new-folder-btn');
    await expect(newFolderBtn).toBeVisible({ timeout: 10000 });
  });

  test('should create a new folder @smoke', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click New Folder button
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    // Check input appears
    const folderInput = page.locator('.new-folder-input');
    await expect(folderInput).toBeVisible({ timeout: 5000 });

    // Type folder name with unique identifier
    const uniqueName = `UI Test Folder ${Date.now()}`;
    await folderInput.fill(uniqueName);

    // Submit (press Enter)
    await folderInput.press('Enter');

    // Wait for folder to appear
    await page.waitForTimeout(500);

    // Check folder appears in sidebar (exact match)
    const folderName = page.locator('.folder-name', { hasText: uniqueName });
    await expect(folderName).toBeVisible({ timeout: 5000 });
  });

  test('should cancel folder creation with Escape', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click New Folder button
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    // Check input appears
    const folderInput = page.locator('.new-folder-input');
    await expect(folderInput).toBeVisible({ timeout: 5000 });

    // Press Escape to cancel
    await folderInput.press('Escape');

    // Input should disappear
    await expect(folderInput).not.toBeVisible({ timeout: 2000 });

    // New Folder button should be visible again
    await expect(newFolderBtn).toBeVisible();
  });

  test('should expand and collapse folders', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder first
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Expandable Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Find the folder header
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Expandable Folder' }).first();
    await expect(folderHeader).toBeVisible({ timeout: 5000 });

    // Check expand icon is visible
    const expandIcon = folderHeader.locator('.folder-expand-icon');
    await expect(expandIcon).toBeVisible({ timeout: 2000 });

    // Get initial state
    const isInitiallyExpanded = (await folderHeader.getAttribute('aria-expanded')) === 'true';

    // Click to toggle
    await folderHeader.click();
    await page.waitForTimeout(300);

    // Folder should be in opposite state
    const transitionedState = await folderHeader.getAttribute('aria-expanded');
    expect(transitionedState).toBe(isInitiallyExpanded ? 'false' : 'true');

    // Click again to toggle back
    await folderHeader.click();
    await page.waitForTimeout(300);

    // Folder should be back to initial state
    const finalState = await folderHeader.getAttribute('aria-expanded');
    expect(finalState).toBe(isInitiallyExpanded ? 'true' : 'false');
  });

  test('should rename folder by double-clicking', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Original Name');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Find the folder name span
    const folderName = page.locator('.folder-name').filter({ hasText: 'Original Name' }).first();
    await expect(folderName).toBeVisible({ timeout: 5000 });

    // Double-click to edit
    await folderName.dblclick();

    // Check edit input appears
    const editInput = page.locator('.folder-name-input');
    await expect(editInput).toBeVisible({ timeout: 2000 });

    // Clear and type new name
    await editInput.fill('Renamed Folder');
    await editInput.press('Enter');

    // Wait for update
    await page.waitForTimeout(500);

    // Check new name appears
    const renamedFolder = page.locator('.folder-name').filter({ hasText: 'Renamed Folder' }).first();
    await expect(renamedFolder).toBeVisible({ timeout: 5000 });
  });

  test('should delete folder with confirmation', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Delete Me');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Find folder header and hover
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Delete Me' });
    await expect(folderHeader).toBeVisible({ timeout: 5000 });
    await folderHeader.hover();

    // Click delete button
    const deleteBtn = folderHeader.locator('.folder-delete');
    await deleteBtn.click();

    // Check confirmation dialog appears
    await expect(page.locator('text=Delete Folder')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Are you sure')).toBeVisible();

    // Confirm deletion
    await page.locator('button.delete-btn-confirm').click();
    await page.waitForTimeout(500);

    // Folder should be gone
    await expect(folderHeader).not.toBeVisible({ timeout: 5000 });
  });

  test('should set folder as default with pin button', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Default Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Find folder header and hover
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Default Folder' }).first();
    await expect(folderHeader).toBeVisible({ timeout: 5000 });
    await folderHeader.hover();

    // Click pin button
    const pinBtn = folderHeader.locator('.folder-pin');
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Check folder header has is-default class
    await expect(folderHeader).toHaveClass(/is-default/, { timeout: 2000 });

    // Check pin button has is-pinned class
    await expect(pinBtn).toHaveClass(/is-pinned/);
  });

  test('should persist default folder in localStorage', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Persist Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Set as default
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Persist Folder' }).first();
    await folderHeader.hover();
    const pinBtn = folderHeader.locator('.folder-pin');
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Check localStorage
    const savedFolderId = await page.evaluate(() => localStorage.getItem('defaultFolderId'));
    expect(savedFolderId).toBeTruthy();

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check folder still has default class
    const folderHeaderAfterReload = page.locator('.folder-header').filter({ hasText: 'Persist Folder' }).first();
    await expect(folderHeaderAfterReload).toHaveClass(/is-default/, { timeout: 5000 });
  });

  test('should unpin folder when clicking pin again', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Toggle Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Set as default
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Toggle Folder' }).first();
    await folderHeader.hover();
    const pinBtn = folderHeader.locator('.folder-pin');
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Verify it's pinned
    await expect(folderHeader).toHaveClass(/is-default/);

    // Click pin again to unpin
    await folderHeader.hover();
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Verify it's unpinned
    await expect(folderHeader).not.toHaveClass(/is-default/);

    // Check localStorage is cleared
    const savedFolderId = await page.evaluate(() => localStorage.getItem('defaultFolderId'));
    expect(savedFolderId).toBeNull();
  });

  test('should display All Items section for ungrouped conversations', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check All Items header is visible (renamed from "Chats" when docs were added)
    const itemsHeader = page.locator('.ungrouped-header');
    await expect(itemsHeader).toBeVisible({ timeout: 10000 });
    await expect(itemsHeader).toContainText('All Items');
  });

  test('should show folder count badge', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Count Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Find folder and check count badge shows 0
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Count Folder' }).first();
    const countBadge = folderHeader.locator('.folder-count');
    await expect(countBadge).toBeVisible({ timeout: 5000 });
    await expect(countBadge).toHaveText('0');
  });

  test('should create new chat in default folder', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('New Chats Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Set as default
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'New Chats Folder' }).first();
    await folderHeader.hover();
    const pinBtn = folderHeader.locator('.folder-pin');
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Send a message to create a new chat
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Test message for default folder');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;
    await page.waitForTimeout(8000); // Wait for title generation

    // The folder should already be expanded (auto-expanded on creation)
    // Find the folder container and check conversation appears
    const folderContainer = page.locator('.folder-container').filter({ hasText: 'New Chats Folder' }).first();
    const folderConversations = folderContainer.locator('.folder-conversations');

    // If not visible, click to expand
    const isVisible = await folderConversations.isVisible();
    if (!isVisible) {
      await folderHeader.click();
      await page.waitForTimeout(500);
    }

    await expect(folderConversations).toBeVisible({ timeout: 5000 });

    const chatItem = folderConversations.locator('.chat-item');
    await expect(chatItem.first()).toBeVisible({ timeout: 10000 });

    // Check folder count increased (at least 1, could be more due to parallel tests)
    const countBadge = folderHeader.locator('.folder-count');
    const countText = await countBadge.textContent();
    expect(parseInt(countText || '0')).toBeGreaterThanOrEqual(1);
  });

  test('should move conversation to folder via drag and drop API', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create API context with the same user
    const context = await createApiContextForUser(user.token);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder via API
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'Drop Target' },
    });
    const folder = await folderResponse.json();

    // Create a conversation via API
    const convResponse = await context.post('/api/conversations', {
      data: { title: 'Draggable Chat' },
    });
    const conversation = await convResponse.json();

    // Move conversation to folder via API
    const moveResponse = await context.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: folder.id },
    });
    expect(moveResponse.ok()).toBeTruthy();

    // Verify the conversation is in the folder
    const getResponse = await context.get(`/api/conversations/${conversation.id}`);
    const updatedConv = await getResponse.json();
    expect(updatedConv.folder_id).toBe(folder.id);
  });

  test('should remove conversation from folder via API', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create API context with the same user
    const context = await createApiContextForUser(user.token);

    // Create a folder via API
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'Remove From' },
    });
    const folder = await folderResponse.json();

    // Create a conversation in the folder
    const convResponse = await context.post('/api/conversations', {
      data: { title: 'Chat In Folder' },
    });
    const conversation = await convResponse.json();

    // Put conversation in folder
    await context.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: folder.id },
    });

    // Remove from folder (set folder_id to null)
    const removeResponse = await context.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: null },
    });
    expect(removeResponse.ok()).toBeTruthy();

    // Verify the conversation is no longer in the folder
    const getResponse = await context.get(`/api/conversations/${conversation.id}`);
    const updatedConv = await getResponse.json();
    expect(updatedConv.folder_id).toBeNull();
  });

  test('should persist folder expanded state in localStorage', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Expand State Folder');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Find the folder container
    const folderContainer = page.locator('.folder-container').filter({ hasText: 'Expand State Folder' });
    const folderConversations = folderContainer.locator('.folder-conversations');

    // Note: newly created folders are auto-expanded, so it should already be visible
    await expect(folderConversations).toBeVisible({ timeout: 2000 });

    // Check localStorage has expanded folders
    const expandedFolders = await page.evaluate(() => localStorage.getItem('expandedFolders'));
    expect(expandedFolders).toBeTruthy();

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check folder is still expanded after reload
    const folderContainerAfterReload = page.locator('.folder-container').filter({ hasText: 'Expand State Folder' });
    const folderConversationsAfterReload = folderContainerAfterReload.locator('.folder-conversations');
    await expect(folderConversationsAfterReload).toBeVisible({ timeout: 5000 });
  });

  test('should clear default folder when folder is deleted', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a folder
    const newFolderBtn = page.locator('.new-folder-btn');
    await newFolderBtn.click();

    const folderInput = page.locator('.new-folder-input');
    await folderInput.fill('Delete Default');
    await folderInput.press('Enter');
    await page.waitForTimeout(500);

    // Set as default
    const folderHeader = page.locator('.folder-header').filter({ hasText: 'Delete Default' });
    await folderHeader.hover();
    const pinBtn = folderHeader.locator('.folder-pin');
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Verify it's set as default
    const savedBefore = await page.evaluate(() => localStorage.getItem('defaultFolderId'));
    expect(savedBefore).toBeTruthy();

    // Delete the folder
    await folderHeader.hover();
    const deleteBtn = folderHeader.locator('.folder-delete');
    await deleteBtn.click();
    await page.locator('button.delete-btn-confirm').click();
    await page.waitForTimeout(500);

    // Check localStorage is cleared
    const savedAfter = await page.evaluate(() => localStorage.getItem('defaultFolderId'));
    expect(savedAfter).toBeNull();
  });
});

test.describe('Folders API', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should create a new folder via API', async () => {
    const { context } = await createAuthContext();
    const response = await context.post('/api/folders', {
      data: { name: 'API Test Folder' },
    });

    expect(response.ok()).toBeTruthy();
    const folder = await response.json();
    expect(folder).toHaveProperty('id');
    expect(folder.name).toBe('API Test Folder');
  });

  test('should list all folders via API', async () => {
    const { context } = await createAuthContext();

    // Create some folders
    await context.post('/api/folders', { data: { name: 'Folder A' } });
    await context.post('/api/folders', { data: { name: 'Folder B' } });

    const response = await context.get('/api/folders');
    expect(response.ok()).toBeTruthy();

    const folders = await response.json();
    expect(Array.isArray(folders)).toBeTruthy();
    expect(folders.length).toBeGreaterThanOrEqual(2);
  });

  test('should get folder by ID via API', async () => {
    const { context } = await createAuthContext();

    // Create folder
    const createResponse = await context.post('/api/folders', {
      data: { name: 'Get By ID' },
    });
    const created = await createResponse.json();

    // Get folder
    const getResponse = await context.get(`/api/folders/${created.id}`);
    expect(getResponse.ok()).toBeTruthy();

    const folder = await getResponse.json();
    expect(folder.id).toBe(created.id);
    expect(folder.name).toBe('Get By ID');
  });

  test('should update folder name via API', async () => {
    const { context } = await createAuthContext();

    // Create folder
    const createResponse = await context.post('/api/folders', {
      data: { name: 'Original API Name' },
    });
    const created = await createResponse.json();

    // Update folder
    const updateResponse = await context.patch(`/api/folders/${created.id}`, {
      data: { name: 'Updated API Name' },
    });
    expect(updateResponse.ok()).toBeTruthy();

    // Verify update
    const getResponse = await context.get(`/api/folders/${created.id}`);
    const folder = await getResponse.json();
    expect(folder.name).toBe('Updated API Name');
  });

  test('should share shared-folder items across users and allow collaboration via API', async () => {
    const { context: userAContext } = await createAuthContext();
    const { context: userBContext } = await createAuthContext();

    // Both users should see the same shared folder
    const foldersAResponse = await userAContext.get('/api/folders');
    const foldersBResponse = await userBContext.get('/api/folders');
    expect(foldersAResponse.ok()).toBeTruthy();
    expect(foldersBResponse.ok()).toBeTruthy();

    const foldersA = await foldersAResponse.json();
    const foldersB = await foldersBResponse.json();
    const sharedFolderA = foldersA.find((folder: any) => folder.name === 'Shared');
    const sharedFolderB = foldersB.find((folder: any) => folder.name === 'Shared');

    expect(sharedFolderA).toBeTruthy();
    expect(sharedFolderB).toBeTruthy();
    expect(sharedFolderA.id).toBe(sharedFolderB.id);

    // User A creates a conversation and document in Shared
    const conversationResponse = await userAContext.post('/api/conversations', {
      data: { title: 'Shared Conversation' },
    });
    expect(conversationResponse.ok()).toBeTruthy();
    const conversation = await conversationResponse.json();

    const moveConversationResponse = await userAContext.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: sharedFolderA.id },
    });
    expect(moveConversationResponse.ok()).toBeTruthy();

    const documentResponse = await userAContext.post('/api/docs', {
      data: {
        title: 'Shared Document',
        content: 'Original shared content',
        folder_id: sharedFolderA.id,
      },
    });
    expect(documentResponse.ok()).toBeTruthy();
    const document = await documentResponse.json();

    // User B can access both shared items
    const getConversationAsUserB = await userBContext.get(`/api/conversations/${conversation.id}`);
    const getDocumentAsUserB = await userBContext.get(`/api/docs/${document.id}`);
    expect(getConversationAsUserB.ok()).toBeTruthy();
    expect(getDocumentAsUserB.ok()).toBeTruthy();

    // User B can edit the shared doc
    const patchDocAsUserB = await userBContext.patch(`/api/docs/${document.id}`, {
      data: {
        title: 'Shared Document',
        content: 'Updated by second user',
      },
    });
    expect(patchDocAsUserB.ok()).toBeTruthy();

    const getDocAsUserA = await userAContext.get(`/api/docs/${document.id}`);
    const updatedDocAsUserA = await getDocAsUserA.json();
    expect(updatedDocAsUserA.content).toBe('Updated by second user');

    // User B can continue working on the shared chat (adds a user message)
    const chatAsUserB = await userBContext.post('/api/chat', {
      data: {
        conversationId: conversation.id,
        message: 'Message from second user',
        thinking: false,
        mode: 'quick',
        aiProvider: 'gemini',
      },
    });
    expect(chatAsUserB.ok()).toBeTruthy();

    const messagesAsUserAResponse = await userAContext.get(`/api/conversations/${conversation.id}/messages`);
    const messagesAsUserA = await messagesAsUserAResponse.json();
    expect(messagesAsUserA.some((msg: any) => msg.role === 'user' && msg.content === 'Message from second user')).toBeTruthy();
  });

  test('should allow user B snapshot on shared doc and user A should see both edit and snapshot', async () => {
    const { context: userAContext } = await createAuthContext();
    const { context: userBContext } = await createAuthContext();

    const foldersAResponse = await userAContext.get('/api/folders');
    expect(foldersAResponse.ok()).toBeTruthy();
    const foldersA = await foldersAResponse.json();
    const sharedFolder = foldersA.find((folder: any) => folder.name === 'Shared');
    expect(sharedFolder).toBeTruthy();

    // User A creates a document in Shared
    const documentResponse = await userAContext.post('/api/docs', {
      data: {
        title: 'Snapshot Shared Document',
        content: 'Initial content by user A',
        folder_id: sharedFolder.id,
      },
    });
    expect(documentResponse.ok()).toBeTruthy();
    const document = await documentResponse.json();

    // User B edits the shared document
    const editByUserBResponse = await userBContext.patch(`/api/docs/${document.id}`, {
      data: {
        title: 'Snapshot Shared Document',
        content: 'Edited by user B',
      },
    });
    expect(editByUserBResponse.ok()).toBeTruthy();

    // User B creates a snapshot
    const createSnapshotResponse = await userBContext.post(`/api/docs/${document.id}/snapshots`, {
      data: { message: 'Snapshot from user B' },
    });
    expect(createSnapshotResponse.ok()).toBeTruthy();
    const createdSnapshot = await createSnapshotResponse.json();
    expect(createdSnapshot.id).toBeTruthy();

    // User A sees user B's latest doc edits
    const getDocAsUserAResponse = await userAContext.get(`/api/docs/${document.id}`);
    expect(getDocAsUserAResponse.ok()).toBeTruthy();
    const docAsUserA = await getDocAsUserAResponse.json();
    expect(docAsUserA.content).toBe('Edited by user B');

    // User A can also see the snapshot created by user B
    const snapshotsAsUserAResponse = await userAContext.get(`/api/docs/${document.id}/snapshots`);
    expect(snapshotsAsUserAResponse.ok()).toBeTruthy();
    const snapshotsAsUserA = await snapshotsAsUserAResponse.json();
    const snapshotSummary = snapshotsAsUserA.find((snapshot: any) => snapshot.id === createdSnapshot.id);
    expect(snapshotSummary).toBeTruthy();

    const snapshotDetailAsUserAResponse = await userAContext.get(`/api/docs/${document.id}/snapshots/${createdSnapshot.id}`);
    expect(snapshotDetailAsUserAResponse.ok()).toBeTruthy();
    const snapshotDetailAsUserA = await snapshotDetailAsUserAResponse.json();
    expect(snapshotDetailAsUserA.content).toBe('Edited by user B');
    expect(snapshotDetailAsUserA.message).toBe('Snapshot from user B');
  });

  test('should delete folder via API', async () => {
    const { context } = await createAuthContext();

    // Create folder
    const createResponse = await context.post('/api/folders', {
      data: { name: 'Delete API' },
    });
    const created = await createResponse.json();

    // Delete folder
    const deleteResponse = await context.delete(`/api/folders/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();

    // Verify deleted
    const getResponse = await context.get(`/api/folders/${created.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('should move conversations to ungrouped when folder is deleted', async () => {
    const { context } = await createAuthContext();

    // Create folder
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'To Be Deleted' },
    });
    const folder = await folderResponse.json();

    // Create conversation in folder
    const convResponse = await context.post('/api/conversations', {
      data: { title: 'Orphaned Chat' },
    });
    const conversation = await convResponse.json();

    // Put conversation in folder
    await context.patch(`/api/conversations/${conversation.id}`, {
      data: { folder_id: folder.id },
    });

    // Delete folder
    await context.delete(`/api/folders/${folder.id}`);

    // Check conversation is now ungrouped
    const getConvResponse = await context.get(`/api/conversations/${conversation.id}`);
    const updatedConv = await getConvResponse.json();
    expect(updatedConv.folder_id).toBeNull();
  });
});
