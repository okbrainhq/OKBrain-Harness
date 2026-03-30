import { test, expect, request } from '@playwright/test';
import { loadTestEnv, verifyTestDb, setupPageWithUser, createUniqueUser, clickNewFileBrowser } from './test-utils';

// Load test environment before tests
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

test.describe('File Browser Feature', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show Files option in New dropdown', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newBtn = page.locator('.new-btn');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();

    const dropdown = page.locator('.new-menu-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await expect(dropdown.locator('text=Chat')).toBeVisible();
    await expect(dropdown.locator('text=Doc')).toBeVisible();
    await expect(dropdown.locator('text=Files')).toBeVisible();
  });

  test('should create a file browser and navigate to it @smoke', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);

    // Should navigate to filebrowser page
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Title input should be visible with default title
    const titleInput = page.locator('.filebrowser-title-input');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('File Browser');
  });

  test('should show file browser in sidebar after creation', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Update title for identification
    const titleInput = page.locator('.filebrowser-title-input');
    await titleInput.click();
    await titleInput.clear();
    await titleInput.fill('My Test Files');
    await page.waitForTimeout(1500);

    // Go back to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check file browser appears in sidebar
    const fbItem = page.locator('.chat-item').filter({ hasText: 'My Test Files' }).first();
    await expect(fbItem).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to file browser when clicking in sidebar', async ({ page }) => {
    const user = await setupPageWithUser(page);

    // Create file browser via API
    const context = await createApiContextForUser(user.token);
    const fbResponse = await context.post('/api/filebrowser', {
      data: { title: 'Clickable FB' },
    });
    const fb = await fbResponse.json();
    expect(fbResponse.ok()).toBeTruthy();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the file browser in sidebar
    const fbItem = page.locator('.chat-item').filter({ hasText: 'Clickable FB' }).first();
    await expect(fbItem).toBeVisible({ timeout: 5000 });
    await fbItem.click();

    // Should navigate to the file browser page
    await page.waitForURL(`/filebrowser/${fb.id}`, { timeout: 5000 });

    const titleInput = page.locator('.filebrowser-title-input');
    await expect(titleInput).toHaveValue('Clickable FB', { timeout: 5000 });
  });

  test('should show breadcrumb at root path', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Breadcrumb should show ~ (home)
    const breadcrumb = page.locator('.filebrowser-breadcrumb');
    await expect(breadcrumb).toBeVisible({ timeout: 5000 });

    const homeSegment = breadcrumb.locator('.filebrowser-breadcrumb-segment');
    await expect(homeSegment.first()).toHaveText('~');
  });

  test('should show directory listing or empty state', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Should show either a listing or empty/error state (depends on sandbox user having files)
    const listing = page.locator('.filebrowser-listing');
    const empty = page.locator('.filebrowser-empty');
    const error = page.locator('.filebrowser-error');

    // One of these should be visible
    await expect(listing.or(empty).or(error)).toBeVisible({ timeout: 10000 });
  });

  test('should show New File and New Folder icon buttons', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Wait for directory listing to load
    await page.waitForTimeout(2000);

    const newFileBtn = page.locator('.filebrowser-action-btn[title="New File"]');
    const newFolderBtn = page.locator('.filebrowser-action-btn[title="New Folder"]');

    await expect(newFileBtn).toBeVisible({ timeout: 5000 });
    await expect(newFolderBtn).toBeVisible({ timeout: 5000 });
  });

  test('should create a new file from UI', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Wait for listing to load
    await page.waitForTimeout(1000);

    // Click New File
    const newFileBtn = page.locator('.filebrowser-action-btn[title="New File"]');
    await newFileBtn.click();

    // Input should appear
    const input = page.locator('.filebrowser-create-input input');
    await expect(input).toBeVisible({ timeout: 3000 });

    // Type name and submit
    const fileName = `ui-test-${Date.now()}.txt`;
    await input.fill(fileName);
    await input.press('Enter');

    // Wait for creation and listing refresh
    await page.waitForTimeout(2000);

    // File should appear in listing
    const entry = page.locator('.filebrowser-entry-name').filter({ hasText: fileName });
    await expect(entry).toBeVisible({ timeout: 5000 });
  });

  test('should create a new folder from UI', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Wait for listing to load
    await page.waitForTimeout(1000);

    // Click New Folder
    const newFolderBtn = page.locator('.filebrowser-action-btn[title="New Folder"]');
    await newFolderBtn.click();

    // Input should appear
    const input = page.locator('.filebrowser-create-input input');
    await expect(input).toBeVisible({ timeout: 3000 });

    // Type name and submit
    const folderName = `ui-folder-${Date.now()}`;
    await input.fill(folderName);
    await input.press('Enter');

    // Wait for creation and listing refresh
    await page.waitForTimeout(2000);

    // Folder should appear in listing
    const entry = page.locator('.filebrowser-entry-name').filter({ hasText: folderName });
    await expect(entry).toBeVisible({ timeout: 5000 });
  });

  test('should cancel create with Escape', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    await page.waitForTimeout(1000);

    // Click New File
    const newFileBtn = page.locator('.filebrowser-action-btn[title="New File"]');
    await newFileBtn.click();

    // Input should appear
    const input = page.locator('.filebrowser-create-input input');
    await expect(input).toBeVisible({ timeout: 3000 });

    // Press Escape
    await input.press('Escape');

    // Input should disappear, action buttons should return
    await expect(input).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('.filebrowser-action-btn[title="New File"]')).toBeVisible({ timeout: 2000 });
  });

  test('should upload a file from UI', async ({ page }) => {
    const user = await setupPageWithUser(page);

    // Create a file browser and navigate to it
    const context = await createApiContextForUser(user.token);
    const fbRes = await context.post('/api/filebrowser', { data: { title: 'Upload UI Test' } });
    const fb = await fbRes.json();

    await page.goto(`/filebrowser/${fb.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for directory listing to load
    const listing = page.locator('.filebrowser-listing');
    const empty = page.locator('.filebrowser-empty');
    await expect(listing.or(empty)).toBeVisible({ timeout: 10000 });

    // Upload button should be visible
    const uploadBtn = page.locator('.filebrowser-action-btn[title="Upload Files"]');
    await expect(uploadBtn).toBeVisible({ timeout: 5000 });

    // Create a test file via the hidden file input
    const fileInput = page.locator('input[type="file"]');
    const fileName = `upload-ui-${Date.now()}.txt`;
    const fileContent = 'uploaded from ui test';

    // Set file on the input
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent),
    });

    // Wait for upload to complete and listing to refresh
    await page.waitForTimeout(3000);

    // File should appear in listing
    const entry = page.locator('.filebrowser-entry-name').filter({ hasText: fileName });
    await expect(entry).toBeVisible({ timeout: 5000 });
  });

  test('should rename a file from UI', async ({ page }) => {
    const user = await setupPageWithUser(page);

    // Create a file browser and a test file via API
    const context = await createApiContextForUser(user.token);
    const fbRes = await context.post('/api/filebrowser', { data: { title: 'Rename UI Test' } });
    const fb = await fbRes.json();

    const origName = `rename-orig-${Date.now()}.txt`;
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${origName}`, content: 'rename me' },
    });

    await page.goto(`/filebrowser/${fb.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for file to appear in listing
    const entry = page.locator('.filebrowser-entry').filter({ hasText: origName });
    await expect(entry).toBeVisible({ timeout: 10000 });

    // Make action buttons visible (they're hidden until hover via opacity)
    await page.addStyleTag({ content: '.filebrowser-entry-action { opacity: 1 !important; }' });
    // Click the rename button (pencil icon)
    const renameBtn = entry.locator('button[title="Rename"]');
    await renameBtn.click();

    // Rename input should appear (search on page level since entry's hasText won't match input value)
    const renameInput = page.locator('.filebrowser-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });

    // Clear and type new name
    const newName = `renamed-${Date.now()}.txt`;
    await renameInput.clear();
    await renameInput.fill(newName);
    await renameInput.press('Enter');

    // Wait for rename and listing refresh
    await page.waitForTimeout(2000);

    // New name should appear, old name should not
    const newEntry = page.locator('.filebrowser-entry-name').filter({ hasText: newName });
    await expect(newEntry).toBeVisible({ timeout: 5000 });

    const oldEntry = page.locator('.filebrowser-entry-name').filter({ hasText: origName });
    await expect(oldEntry).not.toBeVisible({ timeout: 2000 });
  });

  test('should cancel rename with Escape', async ({ page }) => {
    const user = await setupPageWithUser(page);

    const context = await createApiContextForUser(user.token);
    const fbRes = await context.post('/api/filebrowser', { data: { title: 'Cancel Rename Test' } });
    const fb = await fbRes.json();

    const fileName = `cancel-rename-${Date.now()}.txt`;
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${fileName}`, content: 'keep me' },
    });

    await page.goto(`/filebrowser/${fb.id}`);
    await page.waitForLoadState('networkidle');

    const entry = page.locator('.filebrowser-entry').filter({ hasText: fileName });
    await expect(entry).toBeVisible({ timeout: 10000 });

    // Make action buttons visible and click rename
    await page.addStyleTag({ content: '.filebrowser-entry-action { opacity: 1 !important; }' });
    const renameBtn = entry.locator('button[title="Rename"]');
    await renameBtn.click();

    // Rename input should appear (search on page level)
    const renameInput = page.locator('.filebrowser-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });

    // Press Escape
    await renameInput.press('Escape');

    // Input should disappear, original name should still be there
    await expect(renameInput).not.toBeVisible({ timeout: 2000 });
    const nameEntry = page.locator('.filebrowser-entry-name').filter({ hasText: fileName });
    await expect(nameEntry).toBeVisible({ timeout: 2000 });
  });

  test('should hide chat input box on file browser page', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify chat input is visible on home page
    const chatInput = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Create new file browser
    await clickNewFileBrowser(page);
    await page.waitForURL(/\/filebrowser\//, { timeout: 10000 });

    // Chat input should not be visible on file browser page
    await expect(chatInput).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('File Browser API', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should create a file browser via API', async () => {
    const { context } = await createAuthContext();
    const response = await context.post('/api/filebrowser', {
      data: { title: 'API Test FB' },
    });

    expect(response.ok()).toBeTruthy();
    const fb = await response.json();
    expect(fb).toHaveProperty('id');
    expect(fb.title).toBe('API Test FB');
    expect(fb.current_path).toBe('/');
  });

  test('should get file browser by ID via API', async () => {
    const { context } = await createAuthContext();

    const createResponse = await context.post('/api/filebrowser', {
      data: { title: 'Get Test FB' },
    });
    const created = await createResponse.json();

    const getResponse = await context.get(`/api/filebrowser/${created.id}`);
    expect(getResponse.ok()).toBeTruthy();

    const fb = await getResponse.json();
    expect(fb.id).toBe(created.id);
    expect(fb.title).toBe('Get Test FB');
  });

  test('should update file browser title via API', async () => {
    const { context } = await createAuthContext();

    const createResponse = await context.post('/api/filebrowser', {
      data: { title: 'Original FB Title' },
    });
    const created = await createResponse.json();

    const updateResponse = await context.patch(`/api/filebrowser/${created.id}`, {
      data: { title: 'Updated FB Title' },
    });
    expect(updateResponse.ok()).toBeTruthy();

    const getResponse = await context.get(`/api/filebrowser/${created.id}`);
    const fb = await getResponse.json();
    expect(fb.title).toBe('Updated FB Title');
  });

  test('should update file browser current_path via API', async () => {
    const { context } = await createAuthContext();

    const createResponse = await context.post('/api/filebrowser', {
      data: { title: 'Path Test FB' },
    });
    const created = await createResponse.json();

    const updateResponse = await context.patch(`/api/filebrowser/${created.id}`, {
      data: { current_path: '/projects' },
    });
    expect(updateResponse.ok()).toBeTruthy();

    const getResponse = await context.get(`/api/filebrowser/${created.id}`);
    const fb = await getResponse.json();
    expect(fb.current_path).toBe('/projects');
  });

  test('should delete file browser via API', async () => {
    const { context } = await createAuthContext();

    const createResponse = await context.post('/api/filebrowser', {
      data: { title: 'Delete Me FB' },
    });
    const created = await createResponse.json();

    const deleteResponse = await context.delete(`/api/filebrowser/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();

    const getResponse = await context.get(`/api/filebrowser/${created.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('should move file browser to folder via API', async () => {
    const { context } = await createAuthContext();

    // Create folder
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'FB Folder' },
    });
    const folder = await folderResponse.json();

    // Create file browser
    const fbResponse = await context.post('/api/filebrowser', {
      data: { title: 'Movable FB' },
    });
    const fb = await fbResponse.json();

    // Move to folder
    const moveResponse = await context.patch(`/api/filebrowser/${fb.id}`, {
      data: { folder_id: folder.id },
    });
    expect(moveResponse.ok()).toBeTruthy();

    // Verify
    const getResponse = await context.get(`/api/filebrowser/${fb.id}`);
    const updatedFb = await getResponse.json();
    expect(updatedFb.folder_id).toBe(folder.id);
  });

  test('should remove file browser from folder via API', async () => {
    const { context } = await createAuthContext();

    // Create folder
    const folderResponse = await context.post('/api/folders', {
      data: { name: 'Remove FB Folder' },
    });
    const folder = await folderResponse.json();

    // Create file browser in folder
    const fbResponse = await context.post('/api/filebrowser', {
      data: { title: 'Removable FB', folder_id: folder.id },
    });
    const fb = await fbResponse.json();

    // Remove from folder
    const removeResponse = await context.patch(`/api/filebrowser/${fb.id}`, {
      data: { folder_id: null },
    });
    expect(removeResponse.ok()).toBeTruthy();

    const getResponse = await context.get(`/api/filebrowser/${fb.id}`);
    const updatedFb = await getResponse.json();
    expect(updatedFb.folder_id).toBeNull();
  });

  test('should include file browsers in search results', async () => {
    const { context } = await createAuthContext();

    // Create a file browser with a distinctive title
    await context.post('/api/filebrowser', {
      data: { title: 'UniqueSearchableFB123' },
    });

    // Search for it
    const searchResponse = await context.get('/api/search?q=UniqueSearchableFB123');
    expect(searchResponse.ok()).toBeTruthy();

    const data = await searchResponse.json();
    expect(data.fileBrowsers).toBeDefined();
    expect(data.fileBrowsers.length).toBeGreaterThan(0);
    expect(data.fileBrowsers[0].title).toBe('UniqueSearchableFB123');
  });

  test('should include file browsers in sidebar items', async () => {
    const { context } = await createAuthContext();

    // Create a file browser
    const fbResponse = await context.post('/api/filebrowser', {
      data: { title: 'Sidebar FB Test' },
    });
    const fb = await fbResponse.json();

    // Fetch sidebar items
    const sidebarResponse = await context.get('/api/sidebar/items?type=uncategorized&limit=50&offset=0');
    expect(sidebarResponse.ok()).toBeTruthy();

    const items = await sidebarResponse.json();
    const fbItem = items.find((item: any) => item.id === fb.id);
    expect(fbItem).toBeDefined();
    expect(fbItem.type).toBe('filebrowser');
    expect(fbItem.title).toBe('Sidebar FB Test');
  });
});

test.describe('File Browser FS API', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should list root directory', async () => {
    const { context } = await createAuthContext();

    const response = await context.get('/api/filebrowser/fs/list?path=/');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('entries');
    expect(data).toHaveProperty('path', '/');
    expect(Array.isArray(data.entries)).toBeTruthy();
  });

  test('should write and read a file', async () => {
    const { context } = await createAuthContext();

    const testContent = `Hello from e2e test ${Date.now()}`;
    const testPath = `/test-e2e-${Date.now()}.txt`;

    // Write file
    const writeResponse = await context.post('/api/filebrowser/fs/write', {
      data: { path: testPath, content: testContent },
    });
    expect(writeResponse.ok()).toBeTruthy();

    // Read file back
    const readResponse = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(testPath)}`);
    expect(readResponse.ok()).toBeTruthy();

    const data = await readResponse.json();
    expect(data.content).toBe(testContent);
    expect(data.path).toBe(testPath);
  });

  test('should reject path traversal attempts', async () => {
    const { context } = await createAuthContext();

    // Try to read outside sandbox
    const response = await context.get('/api/filebrowser/fs/read?path=../../etc/passwd');
    expect(response.ok()).toBeFalsy();

    const data = await response.json();
    expect(data.error).toContain('path traversal');
  });

  test('should create a directory via API', async () => {
    const { context } = await createAuthContext();

    const dirName = `test-mkdir-${Date.now()}`;
    const response = await context.post('/api/filebrowser/fs/mkdir', {
      data: { path: `/${dirName}` },
    });
    expect(response.ok()).toBeTruthy();

    // Verify it appears in listing
    const listResponse = await context.get('/api/filebrowser/fs/list?path=/');
    const data = await listResponse.json();
    const created = data.entries.find((e: any) => e.name === dirName);
    expect(created).toBeDefined();
    expect(created.isDirectory).toBe(true);
  });

  test('should create a file inside a new directory', async () => {
    const { context } = await createAuthContext();

    const dirName = `test-nested-${Date.now()}`;
    // Create directory
    await context.post('/api/filebrowser/fs/mkdir', {
      data: { path: `/${dirName}` },
    });

    // Create file inside it
    const writeResponse = await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${dirName}/hello.txt`, content: 'nested file' },
    });
    expect(writeResponse.ok()).toBeTruthy();

    // Read it back
    const readResponse = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(`/${dirName}/hello.txt`)}`);
    expect(readResponse.ok()).toBeTruthy();
    const data = await readResponse.json();
    expect(data.content).toBe('nested file');
  });

  test('should delete a file via API', async () => {
    const { context } = await createAuthContext();

    const fileName = `test-del-${Date.now()}.txt`;
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${fileName}`, content: 'delete me' },
    });

    // Delete it
    const delResponse = await context.post('/api/filebrowser/fs/delete', {
      data: { path: `/${fileName}` },
    });
    expect(delResponse.ok()).toBeTruthy();

    // Verify it's gone
    const readResponse = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(`/${fileName}`)}`);
    expect(readResponse.ok()).toBeFalsy();
  });

  test('should delete a directory via API', async () => {
    const { context } = await createAuthContext();

    const dirName = `test-deldir-${Date.now()}`;
    await context.post('/api/filebrowser/fs/mkdir', {
      data: { path: `/${dirName}` },
    });

    // Put a file inside
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${dirName}/inner.txt`, content: 'inner' },
    });

    // Delete the directory
    const delResponse = await context.post('/api/filebrowser/fs/delete', {
      data: { path: `/${dirName}` },
    });
    expect(delResponse.ok()).toBeTruthy();

    // Verify it's gone from listing
    const listResponse = await context.get('/api/filebrowser/fs/list?path=/');
    const data = await listResponse.json();
    const found = data.entries.find((e: any) => e.name === dirName);
    expect(found).toBeUndefined();
  });

  test('should reject deleting root path', async () => {
    const { context } = await createAuthContext();

    const response = await context.post('/api/filebrowser/fs/delete', {
      data: { path: '/' },
    });
    expect(response.ok()).toBeFalsy();
  });

  test('should list directory entries with metadata', async () => {
    const { context } = await createAuthContext();

    // Write a test file first to ensure directory isn't empty
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/test-ls-${Date.now()}.txt`, content: 'hello' },
    });

    const response = await context.get('/api/filebrowser/fs/list?path=/');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.entries.length).toBeGreaterThan(0);

    // Each entry should have the expected fields
    const entry = data.entries[0];
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('isDirectory');
    expect(entry).toHaveProperty('size');
    expect(entry).toHaveProperty('modifiedAt');
  });

  test('should upload a file via API', async () => {
    const { context } = await createAuthContext();

    const fileName = `upload-api-${Date.now()}.txt`;
    const fileContent = 'hello from upload test';

    const response = await context.post('/api/filebrowser/fs/upload', {
      multipart: {
        file: {
          name: fileName,
          mimeType: 'text/plain',
          buffer: Buffer.from(fileContent),
        },
        path: '/',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.name).toBe(fileName);

    // Verify the file exists and has the right content
    const readResponse = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(`/${fileName}`)}`);
    expect(readResponse.ok()).toBeTruthy();
    const readData = await readResponse.json();
    expect(readData.content).toBe(fileContent);
  });

  test('should upload a binary file via API', async () => {
    const { context } = await createAuthContext();

    const fileName = `upload-bin-${Date.now()}.bin`;
    // Create binary content with various byte values
    const binaryContent = Buffer.from([0x00, 0x01, 0xFF, 0x80, 0x7F, 0xAB, 0xCD, 0xEF]);

    const response = await context.post('/api/filebrowser/fs/upload', {
      multipart: {
        file: {
          name: fileName,
          mimeType: 'application/octet-stream',
          buffer: binaryContent,
        },
        path: '/',
      },
    });

    expect(response.ok()).toBeTruthy();

    // Verify the file appears in listing with correct size
    const listResponse = await context.get('/api/filebrowser/fs/list?path=/');
    const listData = await listResponse.json();
    const uploaded = listData.entries.find((e: any) => e.name === fileName);
    expect(uploaded).toBeDefined();
    expect(uploaded.size).toBe(8);
  });

  test('should upload a file into a subdirectory', async () => {
    const { context } = await createAuthContext();

    const dirName = `upload-dir-${Date.now()}`;
    await context.post('/api/filebrowser/fs/mkdir', {
      data: { path: `/${dirName}` },
    });

    const fileName = `subdir-file-${Date.now()}.txt`;
    const response = await context.post('/api/filebrowser/fs/upload', {
      multipart: {
        file: {
          name: fileName,
          mimeType: 'text/plain',
          buffer: Buffer.from('file in subdir'),
        },
        path: `/${dirName}`,
      },
    });

    expect(response.ok()).toBeTruthy();

    // Verify file is inside the subdirectory
    const listResponse = await context.get(`/api/filebrowser/fs/list?path=${encodeURIComponent(`/${dirName}`)}`);
    const listData = await listResponse.json();
    const uploaded = listData.entries.find((e: any) => e.name === fileName);
    expect(uploaded).toBeDefined();
  });

  test('should rename a file via API', async () => {
    const { context } = await createAuthContext();

    const oldName = `rename-old-${Date.now()}.txt`;
    const newName = `rename-new-${Date.now()}.txt`;

    // Create the file
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${oldName}`, content: 'rename test content' },
    });

    // Rename it
    const renameResponse = await context.post('/api/filebrowser/fs/rename', {
      data: { oldPath: `/${oldName}`, newPath: `/${newName}` },
    });
    expect(renameResponse.ok()).toBeTruthy();

    // Old file should not exist
    const readOld = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(`/${oldName}`)}`);
    expect(readOld.ok()).toBeFalsy();

    // New file should exist with same content
    const readNew = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(`/${newName}`)}`);
    expect(readNew.ok()).toBeTruthy();
    const data = await readNew.json();
    expect(data.content).toBe('rename test content');
  });

  test('should rename a directory via API', async () => {
    const { context } = await createAuthContext();

    const oldDir = `rename-dir-old-${Date.now()}`;
    const newDir = `rename-dir-new-${Date.now()}`;

    // Create directory with a file inside
    await context.post('/api/filebrowser/fs/mkdir', {
      data: { path: `/${oldDir}` },
    });
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${oldDir}/inner.txt`, content: 'inner content' },
    });

    // Rename the directory
    const renameResponse = await context.post('/api/filebrowser/fs/rename', {
      data: { oldPath: `/${oldDir}`, newPath: `/${newDir}` },
    });
    expect(renameResponse.ok()).toBeTruthy();

    // Old directory should not exist
    const listOld = await context.get(`/api/filebrowser/fs/list?path=${encodeURIComponent(`/${oldDir}`)}`);
    expect(listOld.ok()).toBeFalsy();

    // New directory should exist with the inner file
    const listNew = await context.get(`/api/filebrowser/fs/list?path=${encodeURIComponent(`/${newDir}`)}`);
    expect(listNew.ok()).toBeTruthy();
    const listData = await listNew.json();
    const innerFile = listData.entries.find((e: any) => e.name === 'inner.txt');
    expect(innerFile).toBeDefined();
  });

  test('should reject renaming with path traversal', async () => {
    const { context } = await createAuthContext();

    const fileName = `rename-traversal-${Date.now()}.txt`;
    await context.post('/api/filebrowser/fs/write', {
      data: { path: `/${fileName}`, content: 'traversal test' },
    });

    const response = await context.post('/api/filebrowser/fs/rename', {
      data: { oldPath: `/${fileName}`, newPath: '../../etc/evil.txt' },
    });
    expect(response.ok()).toBeFalsy();
  });

  test('should reject upload without a file', async () => {
    const { context } = await createAuthContext();

    const response = await context.post('/api/filebrowser/fs/upload', {
      multipart: {
        path: '/',
      },
    });
    expect(response.ok()).toBeFalsy();
  });
});
