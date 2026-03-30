import { test, expect, request } from '@playwright/test';
import { loadTestEnv, verifyTestDb, setupPageWithUser, createUniqueUser, clickNewDoc } from './test-utils';

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

test.describe('Documents Feature', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should display New button with dropdown in sidebar', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if New button is visible
    const newBtn = page.locator('.new-btn');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await expect(newBtn).toContainText('New');

    // Click and verify dropdown appears with both options
    await newBtn.click();
    const dropdown = page.locator('.new-menu-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await expect(dropdown.locator('text=Chat')).toBeVisible();
    await expect(dropdown.locator('text=Doc')).toBeVisible();
  });

  test('should create a new document and navigate to it @smoke', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click New Doc button
    await clickNewDoc(page);

    // Should navigate to doc page
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Check document editor is visible
    const titleInput = page.locator('.document-title-input');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('Untitled Document');

    // Check TipTap editor is visible
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
  });

  test('should hide chat input box on document page', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify chat input is visible on home page
    const chatInput = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Chat input should not be visible on doc page
    await expect(chatInput).not.toBeVisible({ timeout: 3000 });
  });

  test('should update document title', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Update title - clear first then type to ensure onChange triggers
    const titleInput = page.locator('.document-title-input');
    await titleInput.click();
    await titleInput.clear();
    await titleInput.type('My Test Document');

    // Wait for auto-save (debounce)
    await page.waitForTimeout(2000);

    // Reload page and verify title persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(titleInput).toHaveValue('My Test Document', { timeout: 5000 });
  });

  test('should update document content @smoke', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Update content using TipTap editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await page.keyboard.type('This is my test document content.', { delay: 10 });

    // Wait for auto-save (debounce is 1 second + save request)
    await page.waitForTimeout(2500);

    // Reload page and verify content persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(editor).toContainText('This is my test document content.', { timeout: 5000 });
  });

  test('should show document in sidebar after creation', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Update title so we can identify it
    const titleInput = page.locator('.document-title-input');
    await titleInput.click();
    await titleInput.clear();
    await titleInput.type('Sidebar Test Doc');
    await page.waitForTimeout(2000);

    // Go back to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check document appears in sidebar
    const docItem = page.locator('.chat-item').filter({ hasText: 'Sidebar Test Doc' }).first();
    await expect(docItem).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to document when clicking in sidebar', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create document via API with specific title (using same user's auth)
    const context = await createApiContextForUser(user.token);
    const docResponse = await context.post('/api/docs', {
      data: { title: 'Clickable Doc', content: '' },
    });
    const doc = await docResponse.json();
    expect(docResponse.ok()).toBeTruthy();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the document in sidebar
    const docItem = page.locator('.chat-item').filter({ hasText: 'Clickable Doc' }).first();
    await expect(docItem).toBeVisible({ timeout: 5000 });
    await docItem.click();

    // Should navigate to the doc page
    await page.waitForURL(`/doc/${doc.id}`, { timeout: 5000 });

    // Verify the document page loads correctly
    const titleInput = page.locator('.document-title-input');
    await expect(titleInput).toHaveValue('Clickable Doc', { timeout: 5000 });
  });

  test('should delete document from doc menu', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create document via API with specific title (using same user's auth)
    const context = await createApiContextForUser(user.token);
    const docResponse = await context.post('/api/docs', {
      data: { title: 'Delete Me Doc', content: '' },
    });
    expect(docResponse.ok()).toBeTruthy();
    const doc = await docResponse.json();

    // Navigate directly to the document
    await page.goto(`/doc/${doc.id}`);
    await page.waitForLoadState('networkidle');

    // Open the top-right menu and click Delete
    await page.locator('.chat-menu-button').click();
    await page.locator('.chat-menu-item-danger').click();

    // Confirm deletion
    await expect(page.locator('text=Delete Document')).toBeVisible({ timeout: 5000 });
    await page.locator('button.delete-btn-confirm').click();
    await page.waitForTimeout(500);

    // Should be redirected away from the doc
    await expect(page).not.toHaveURL(/\/doc\//, { timeout: 5000 });
  });

  test('should show document icon in sidebar', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Update title
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('Icon Test Doc');
    await page.waitForTimeout(1500);

    // Go back to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check document has the document icon (FileText)
    const docItem = page.locator('.chat-item').filter({ hasText: 'Icon Test Doc' }).first();
    await expect(docItem).toBeVisible({ timeout: 5000 });
    await expect(docItem.locator('.chat-item-icon svg')).toBeVisible();
  });

  test('should show chat icon for conversations', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create a conversation via API (using same user's auth)
    const context = await createApiContextForUser(user.token);
    const convResponse = await context.post('/api/conversations', {
      data: { title: 'Test Chat for Icon' },
    });
    expect(convResponse.ok()).toBeTruthy();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check conversation has the chat icon (MessageSquare)
    const chatItem = page.locator('.chat-item').filter({ hasText: 'Test Chat for Icon' }).first();
    await expect(chatItem).toBeVisible({ timeout: 5000 });
    await expect(chatItem.locator('.chat-item-icon svg')).toBeVisible();
  });

  test('should show and update document saved status', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Status should be visible (initial save from creation or just loaded)
    const statusIndicator = page.locator('.document-status');
    await expect(statusIndicator).toBeVisible({ timeout: 5000 });
    // Accept any valid saved status or date
    await expect(statusIndicator).toContainText(/Saved (now|\d+[mh] ago|[A-Z][a-z]+ \d+)/);

    // Update title to trigger auto-save
    const titleInput = page.locator('.document-title-input');
    await titleInput.click();
    await titleInput.clear();
    await titleInput.type('Status Test Doc');

    // It should transition to "Saved now" (after 1s debounce + save time)
    const savedIndicator = page.locator('.saved-indicator');
    await expect(savedIndicator).toBeVisible({ timeout: 5000 });
    await expect(savedIndicator).toHaveText('Saved now');

    // Verify it stays there after reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.saved-indicator')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Documents API', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should return empty documents list initially', async ({ request }) => {
    const { context } = await createAuthContext();
    const response = await context.get('/api/docs');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('should create a new document via API', async ({ request }) => {
    const { context } = await createAuthContext();
    const response = await context.post('/api/docs', {
      data: { title: 'API Test Document', content: 'Test content' },
    });

    expect(response.ok()).toBeTruthy();
    const document = await response.json();
    expect(document).toHaveProperty('id');
    expect(document.title).toBe('API Test Document');
    expect(document.content).toBe('Test content');
  });

  test('should get document by ID via API', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create document first
    const createResponse = await context.post('/api/docs', {
      data: { title: 'Test Get Doc', content: 'Get content' },
    });
    const created = await createResponse.json();

    // Get document
    const getResponse = await context.get(`/api/docs/${created.id}`);
    expect(getResponse.ok()).toBeTruthy();

    const document = await getResponse.json();
    expect(document.id).toBe(created.id);
    expect(document.title).toBe('Test Get Doc');
    expect(document.content).toBe('Get content');
  });

  test('should update document title via API', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create document
    const createResponse = await context.post('/api/docs', {
      data: { title: 'Original Title', content: '' },
    });
    const created = await createResponse.json();

    // Update title
    const updateResponse = await context.patch(`/api/docs/${created.id}`, {
      data: { title: 'Updated Title' },
    });
    expect(updateResponse.ok()).toBeTruthy();

    // Verify update
    const getResponse = await context.get(`/api/docs/${created.id}`);
    const document = await getResponse.json();
    expect(document.title).toBe('Updated Title');
  });

  test('should update document content via API', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create document
    const createResponse = await context.post('/api/docs', {
      data: { title: 'Content Test', content: 'Initial content' },
    });
    const created = await createResponse.json();

    // Update content
    const updateResponse = await context.patch(`/api/docs/${created.id}`, {
      data: { content: 'Updated content' },
    });
    expect(updateResponse.ok()).toBeTruthy();

    // Verify update
    const getResponse = await context.get(`/api/docs/${created.id}`);
    const document = await getResponse.json();
    expect(document.content).toBe('Updated content');
  });

  test('should delete document via API', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create document
    const createResponse = await context.post('/api/docs', {
      data: { title: 'Test Delete Doc', content: '' },
    });
    const created = await createResponse.json();

    // Delete document
    const deleteResponse = await context.delete(`/api/docs/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();

    // Verify deleted
    const getResponse = await context.get(`/api/docs/${created.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('should move document to folder via API', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create folder
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'Doc Folder' },
    });
    const folder = await folderResponse.json();

    // Create document
    const docResponse = await context.post('/api/docs', {
      data: { title: 'Movable Doc', content: '' },
    });
    const document = await docResponse.json();

    // Move document to folder
    const moveResponse = await context.patch(`/api/docs/${document.id}`, {
      data: { folder_id: folder.id },
    });
    expect(moveResponse.ok()).toBeTruthy();

    // Verify move
    const getResponse = await context.get(`/api/docs/${document.id}`);
    const updatedDoc = await getResponse.json();
    expect(updatedDoc.folder_id).toBe(folder.id);
  });

  test('should remove document from folder via API', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create folder
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'Remove From Folder' },
    });
    const folder = await folderResponse.json();

    // Create document in folder
    const docResponse = await context.post('/api/docs', {
      data: { title: 'Removable Doc', content: '', folder_id: folder.id },
    });
    const document = await docResponse.json();

    // Remove from folder
    const removeResponse = await context.patch(`/api/docs/${document.id}`, {
      data: { folder_id: null },
    });
    expect(removeResponse.ok()).toBeTruthy();

    // Verify removal
    const getResponse = await context.get(`/api/docs/${document.id}`);
    const updatedDoc = await getResponse.json();
    expect(updatedDoc.folder_id).toBeNull();
  });

  test('should move document to ungrouped when folder is deleted', async ({ request }) => {
    const { context } = await createAuthContext();

    // Create folder
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'Delete Folder Doc' },
    });
    const folder = await folderResponse.json();

    // Create document in folder
    const docResponse = await context.post('/api/docs', {
      data: { title: 'Orphaned Doc', content: '', folder_id: folder.id },
    });
    const document = await docResponse.json();

    // Delete folder
    await context.delete(`/api/folders/${folder.id}`);

    // Check document is now ungrouped
    const getDocResponse = await context.get(`/api/docs/${document.id}`);
    const updatedDoc = await getDocResponse.json();
    expect(updatedDoc.folder_id).toBeNull();
  });
});

test.describe('Documents and Chats Together', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show both documents and chats in sidebar sorted by updated_at', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create a chat with unique name (using same user's auth)
    const context = await createApiContextForUser(user.token);
    const uniqueChatName = `Mixed Test Chat ${Date.now()}`;
    const chatResponse = await context.post('/api/conversations', {
      data: { title: uniqueChatName },
    });
    expect(chatResponse.ok()).toBeTruthy();

    // Wait a moment
    await page.waitForTimeout(100);

    // Create a document (should be more recent)
    const uniqueDocName = `Mixed Test Doc ${Date.now()}`;
    const docResponse = await context.post('/api/docs', {
      data: { title: uniqueDocName, content: '' },
    });
    expect(docResponse.ok()).toBeTruthy();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Both should be visible
    const chatItem = page.locator('.chat-item').filter({ hasText: uniqueChatName });
    const docItem = page.locator('.chat-item').filter({ hasText: uniqueDocName });

    await expect(chatItem).toBeVisible({ timeout: 5000 });
    await expect(docItem).toBeVisible({ timeout: 5000 });
  });

  test('should create document in default folder when set', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // Create a folder via API with unique name (using same user's auth)
    const context = await createApiContextForUser(user.token);
    const uniqueFolderName = `Default Doc Folder ${Date.now()}`;
    const folderResponse = await context.post('/api/folders', {
      data: { name: uniqueFolderName },
    });
    const folder = await folderResponse.json();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Set folder as default
    const folderHeader = page.locator('.folder-header').filter({ hasText: uniqueFolderName }).first();
    await folderHeader.hover();
    const pinBtn = folderHeader.locator('.folder-pin');
    await pinBtn.click();
    await page.waitForTimeout(300);

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Get doc ID from URL
    const docUrl = page.url();
    const docId = docUrl.split('/doc/')[1];

    // Update title for identification
    const titleInput = page.locator('.document-title-input');
    await titleInput.click();
    await titleInput.clear();
    await titleInput.type('Default Folder Doc');
    await page.waitForTimeout(2000);

    // Verify via API that document is in the folder
    const getResponse = await context.get(`/api/docs/${docId}`);
    const doc = await getResponse.json();
    expect(doc.folder_id).toBe(folder.id);
  });
});

test.describe('Document Links', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should add link using CTRL+K keyboard shortcut', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Type some text in the editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await page.keyboard.type('Check out link', { delay: 10 });

    // Select the text "link" using double-click
    await page.keyboard.press('Control+Shift+ArrowLeft'); // Select word backwards

    // Wait a moment for selection to register
    await page.waitForTimeout(100);

    // Press CTRL+K (or CMD+K on Mac)
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    if (isMac) {
      await page.keyboard.press('Meta+k');
    } else {
      await page.keyboard.press('Control+k');
    }

    // Link dialog should appear
    const linkDialog = page.locator('.link-dialog');
    await expect(linkDialog).toBeVisible({ timeout: 2000 });

    // Enter URL
    const urlInput = page.locator('#link-url');
    await urlInput.fill('https://example.com');

    // Click Insert button
    const insertBtn = page.locator('button').filter({ hasText: 'Insert' });
    await insertBtn.click();

    // Wait for dialog to close
    await expect(linkDialog).not.toBeVisible({ timeout: 2000 });

    // Verify link was created
    const link = editor.locator('a[href="https://example.com"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('link');
  });

  test('should add link using floating button on text selection', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Type some text in the editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await page.keyboard.type('Visit our website', { delay: 10 });

    // Select "website" using keyboard selection
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(500);

    // Floating link button should appear
    const floatingBtn = page.locator('.floating-link-button');
    await expect(floatingBtn).toBeVisible({ timeout: 3000 });

    // Click floating button
    await floatingBtn.click();

    // Link dialog should appear
    const linkDialog = page.locator('.link-dialog');
    await expect(linkDialog).toBeVisible({ timeout: 2000 });

    // Enter URL
    const urlInput = page.locator('#link-url');
    await urlInput.fill('https://mysite.com');

    // Click Insert button
    const insertBtn = page.locator('button').filter({ hasText: 'Insert' });
    await insertBtn.click();

    // Wait for dialog to close
    await expect(linkDialog).not.toBeVisible({ timeout: 2000 });

    // Verify link was created
    const link = editor.locator('a[href="https://mysite.com"]');
    await expect(link).toBeVisible({ timeout: 3000 });
    await expect(link).toContainText('website');
  });

  test('should add link with custom text', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Click in editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await page.waitForTimeout(200);

    // Press CTRL+K without selecting text
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    if (isMac) {
      await page.keyboard.press('Meta+k');
    } else {
      await page.keyboard.press('Control+k');
    }

    // Link dialog should appear
    const linkDialog = page.locator('.link-dialog');
    await expect(linkDialog).toBeVisible({ timeout: 2000 });

    // Enter URL and custom text
    const urlInput = page.locator('#link-url');
    await urlInput.fill('https://example.org');

    const textInput = page.locator('#link-text');
    await textInput.fill('Click here');

    // Click Insert button
    const insertBtn = page.locator('button').filter({ hasText: 'Insert' });
    await insertBtn.click();

    // Wait for dialog to close
    await expect(linkDialog).not.toBeVisible({ timeout: 2000 });

    // Wait a bit for the link to be inserted
    await page.waitForTimeout(300);

    // Verify link was created with custom text
    const link = editor.locator('a[href="https://example.org"]');
    await expect(link).toBeVisible({ timeout: 3000 });
    await expect(link).toContainText('Click here');
  });

  test('should close link dialog with Escape key', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Click in editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await editor.click();

    // Open link dialog
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    if (isMac) {
      await page.keyboard.press('Meta+k');
    } else {
      await page.keyboard.press('Control+k');
    }

    // Link dialog should appear
    const linkDialog = page.locator('.link-dialog');
    await expect(linkDialog).toBeVisible({ timeout: 2000 });

    // Press Escape
    await page.keyboard.press('Escape');

    // Dialog should close
    await expect(linkDialog).not.toBeVisible({ timeout: 2000 });
  });

  test('should disable Insert button when URL is empty', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Click in editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await editor.click();

    // Open link dialog
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    if (isMac) {
      await page.keyboard.press('Meta+k');
    } else {
      await page.keyboard.press('Control+k');
    }

    // Link dialog should appear
    const linkDialog = page.locator('.link-dialog');
    await expect(linkDialog).toBeVisible({ timeout: 2000 });

    // Insert button should be disabled
    const insertBtn = page.locator('button').filter({ hasText: 'Insert' });
    await expect(insertBtn).toBeDisabled();

    // Enter URL
    const urlInput = page.locator('#link-url');
    await urlInput.fill('https://test.com');

    // Insert button should now be enabled
    await expect(insertBtn).toBeEnabled();
  });

  test('should persist links after save and reload', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Type text and add link
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await page.keyboard.type('Test persist', { delay: 10 });

    // Select "persist" using keyboard
    await page.keyboard.press('Control+Shift+ArrowLeft'); // Select word backwards

    // Wait a moment for selection to register
    await page.waitForTimeout(100);

    // Add link
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
    if (isMac) {
      await page.keyboard.press('Meta+k');
    } else {
      await page.keyboard.press('Control+k');
    }

    // Wait for dialog to appear
    const linkDialog = page.locator('.link-dialog');
    await expect(linkDialog).toBeVisible({ timeout: 2000 });

    const urlInput = page.locator('#link-url');
    await urlInput.fill('https://persist.com');

    const insertBtn = page.locator('button').filter({ hasText: 'Insert' });
    await insertBtn.click();

    // Wait for dialog to close
    await expect(linkDialog).not.toBeVisible({ timeout: 2000 });

    // Verify link was created first
    const linkBefore = editor.locator('a[href="https://persist.com"]');
    await expect(linkBefore).toBeVisible({ timeout: 3000 });
    await expect(linkBefore).toContainText('persist');

    // Wait for auto-save (debounce is 1 second + save time)
    await page.waitForTimeout(2500);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for editor to load
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Verify link persists
    const link = editor.locator('a[href="https://persist.com"]');
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toContainText('persist');
  });

  test('should undo and redo using toolbar buttons', async ({ page }) => {
    await setupPageWithUser(page);
    // Toolbar is only visible on mobile
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open sidebar on mobile and create a new document
    await page.locator('.menu-btn').click();
    await page.waitForTimeout(400);
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Type some content
    await editor.click();
    await page.keyboard.type('Hello World', { delay: 10 });
    await expect(editor).toContainText('Hello World');

    // Undo/redo toolbar should be visible when editor is focused
    const undoRedoToolbar = page.locator('.mobile-undo-redo');
    await expect(undoRedoToolbar).toBeVisible({ timeout: 2000 });

    // Collapsed: undo button and expand toggle should be visible
    const undoBtn = page.locator('.mobile-undo-redo-btn[aria-label="Undo"]');
    const expandBtn = page.locator('.mobile-undo-redo-toggle');
    await expect(undoBtn).toBeVisible();
    await expect(expandBtn).toBeVisible();

    // Redo should not be visible yet (collapsed)
    const redoBtn = page.locator('.mobile-undo-redo-btn[aria-label="Redo"]');
    await expect(redoBtn).not.toBeVisible();

    // Click undo to remove the typed text
    await undoBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(200);

    // Text should be undone (at least partially)
    const textAfterUndo = await editor.textContent();
    expect(textAfterUndo?.length ?? 0).toBeLessThan('Hello World'.length);

    // Expand the toolbar
    await expandBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(200);

    // Redo button should now be visible and enabled
    await expect(redoBtn).toBeVisible();
    await expect(redoBtn).toBeEnabled();

    // Click redo to restore the text
    await redoBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(200);

    await expect(editor).toContainText('Hello World');
  });

  test('should expand and collapse toolbar', async ({ page }) => {
    await setupPageWithUser(page);
    // Toolbar is only visible on mobile
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open sidebar on mobile and create a new document
    await page.locator('.menu-btn').click();
    await page.waitForTimeout(400);
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();

    const expandBtn = page.locator('.mobile-undo-redo-toggle');
    const indentBtn = page.locator('.mobile-undo-redo-btn[aria-label="Indent"]');
    const outdentBtn = page.locator('.mobile-undo-redo-btn[aria-label="Outdent"]');
    const redoBtn = page.locator('.mobile-undo-redo-btn[aria-label="Redo"]');

    // Collapsed: extra buttons hidden
    await expect(indentBtn).not.toBeVisible();
    await expect(outdentBtn).not.toBeVisible();
    await expect(redoBtn).not.toBeVisible();

    // Expand
    await expandBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(200);

    // All buttons visible
    await expect(redoBtn).toBeVisible();
    await expect(indentBtn).toBeVisible();
    await expect(outdentBtn).toBeVisible();

    // Collapse again
    await expandBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(200);

    // Extra buttons hidden again
    await expect(redoBtn).not.toBeVisible();
    await expect(indentBtn).not.toBeVisible();
    await expect(outdentBtn).not.toBeVisible();
  });

  test('should hide undo/redo toolbar when editor loses focus', async ({ page }) => {
    await setupPageWithUser(page);
    // Toolbar is only visible on mobile
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open sidebar on mobile and create a new document
    await page.locator('.menu-btn').click();
    await page.waitForTimeout(400);
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Focus editor
    await editor.click();
    const undoRedoToolbar = page.locator('.mobile-undo-redo');
    await expect(undoRedoToolbar).toBeVisible({ timeout: 2000 });

    // Click the title input to blur the editor
    const titleInput = page.locator('.document-title-input');
    await titleInput.click();

    // Toolbar should disappear
    await expect(undoRedoToolbar).not.toBeVisible({ timeout: 2000 });
  });
});
