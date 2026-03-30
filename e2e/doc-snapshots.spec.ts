import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForApiResponse } from './test-utils';

loadTestEnv();

// Helper: create a document and navigate to it
async function createDocAndNavigate(page: any, user: any, title: string, content: string) {
  // Create document via API
  const res = await page.request.post('/api/docs', {
    data: { title, content },
    headers: { 'Cookie': `auth-token=${user.token}` },
  });
  const doc = await res.json();
  await page.goto(`/doc/${doc.id}`);
  await expect(page.locator('.document-title-input')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.document-title-input')).toHaveValue(title);
  return doc;
}

// Helper: create a snapshot via API
async function createSnapshotViaApi(page: any, user: any, docId: string, message: string) {
  await page.request.post(`/api/docs/${docId}/snapshots`, {
    data: { message },
    headers: { 'Cookie': `auth-token=${user.token}` },
  });
}

// Helper: create a snapshot via the UI
async function createSnapshotViaUI(page: any, message: string) {
  // Open snapshots panel if not open
  if (!(await page.locator('.past-chats-panel').isVisible())) {
    await page.getByRole('button', { name: 'Snapshots' }).click();
  }
  // Click the new Add button in the snapshots header
  await page.getByRole('button', { name: 'Add' }).click();

  // Wait for the modal input to appear
  const input = page.getByPlaceholder('What changed?');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(message);
  // Press Enter to submit and wait for the API response
  const responsePromise = page.waitForResponse(
    (res: any) => res.url().includes('/snapshots') && res.request().method() === 'POST',
    { timeout: 10000 }
  );
  await input.press('Enter');
  await responsePromise;
  // Wait for modal to close, or close it manually
  try {
    await expect(input).not.toBeVisible({ timeout: 3000 });
  } catch {
    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible({ timeout: 3000 });
  }
}

test.describe('Document Snapshots', () => {
  test.describe.configure({ mode: 'parallel' });

  test('should create a snapshot from the panel', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const doc = await createDocAndNavigate(page, user, 'Snapshot Test', '<p>Original content</p>');

    // Create snapshot via UI (this opens the snapshots panel)
    await createSnapshotViaUI(page, 'Initial version');

    // Panel is already open from createSnapshotViaUI — verify snapshot appears
    await expect(page.locator('.past-chat-item')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.past-chat-title')).toHaveText('Initial version');
  });

  test('should list multiple snapshots in order', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const doc = await createDocAndNavigate(page, user, 'List Test', '<p>Content</p>');

    // Create two snapshots via API for reliability
    await createSnapshotViaApi(page, user, doc.id, 'First snapshot');
    await page.waitForTimeout(1100); // ensure different created_at
    await createSnapshotViaApi(page, user, doc.id, 'Second snapshot');

    // Open snapshots panel
    await page.getByRole('button', { name: 'Snapshots' }).click();
    const panel = page.locator('.past-chats-panel');
    await expect(panel).toBeVisible();
    const items = panel.locator('.past-chat-title');
    await expect(items).toHaveCount(2, { timeout: 10000 });
    // Most recent first
    await expect(items.nth(0)).toHaveText('Second snapshot');
    await expect(items.nth(1)).toHaveText('First snapshot');
  });

  test('should view snapshot detail with content', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const doc = await createDocAndNavigate(page, user, 'Detail Test', '<p>Snapshot content here</p>');

    // Create snapshot via API
    await createSnapshotViaApi(page, user, doc.id, 'View me');

    // Open snapshots panel and click the snapshot
    await page.getByRole('button', { name: 'Snapshots' }).click();
    await expect(page.locator('.past-chat-item')).toBeVisible({ timeout: 5000 });
    await page.locator('.past-chat-item').click();

    // Snapshot detail modal should show — wait for Restore button
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible({ timeout: 10000 });
    // Share button (scoped to avoid matching other Share buttons)
    await expect(page.locator('button:has-text("Share")').last()).toBeVisible();
    // Delete button - use last() in case sidebar also has one
    await expect(page.locator('button:has-text("Delete")').last()).toBeVisible();
  });

  test('should restore a snapshot', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const doc = await createDocAndNavigate(page, user, 'Restore Test', '<p>Version A</p>');

    // Create snapshot of version A
    await createSnapshotViaUI(page, 'Version A saved');

    // Edit content to version B
    const editor = page.locator('.tiptap[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Version B');
    await page.waitForTimeout(2000); // wait for auto-save

    // Verify content changed
    await expect(editor).toContainText('Version B');

    // Snapshots panel is already open from createSnapshotViaUI — click the snapshot
    await expect(page.locator('.past-chat-item')).toBeVisible({ timeout: 10000 });
    await page.locator('.past-chat-item').click();

    // Accept the confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Restore' }).click();

    // Wait for document to reload — the modal should close
    await expect(page.locator('.past-chat-item')).not.toBeVisible({ timeout: 5000 }).catch(() => { });
    // Wait for editor to re-mount with restored content
    await page.waitForTimeout(1000);

    // Verify content is back to version A
    const restoredEditor = page.locator('.tiptap');
    await expect(restoredEditor).toContainText('Version A');
  });

  test('should delete a snapshot', async ({ page }) => {
    const user = await setupPageWithUser(page);
    const doc = await createDocAndNavigate(page, user, 'Delete Test', '<p>Content</p>');

    // Create snapshot via API
    await createSnapshotViaApi(page, user, doc.id, 'To be deleted');

    // Open snapshots panel
    await page.getByRole('button', { name: 'Snapshots' }).click();
    await expect(page.locator('.past-chat-item')).toHaveCount(1, { timeout: 5000 });

    // Open detail and wait for Restore button to confirm modal loaded
    await page.locator('.past-chat-item').click();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible({ timeout: 10000 });

    // Accept the confirm dialog and delete
    page.on('dialog', async dialog => await dialog.accept());
    const deleteResponse = page.waitForResponse(
      (res: any) => res.url().includes('/snapshots/') && res.request().method() === 'DELETE',
      { timeout: 10000 }
    );
    // Use last() to target the Delete button in the modal (sidebar may also have one)
    await page.locator('button:has-text("Delete")').last().click();
    await deleteResponse;

    // Snapshot list should be empty after refresh
    await expect(page.locator('.past-chat-item')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByText('No snapshots yet. Click "Add" to create one.')).toBeVisible();
  });

  test('should share a snapshot publicly', async ({ page, browser }) => {
    const user = await setupPageWithUser(page);
    const doc = await createDocAndNavigate(page, user, 'Share Snapshot Test', '<p>Shared snapshot content</p>');

    await createSnapshotViaUI(page, 'Shareable version');

    // Snapshots panel is already open from createSnapshotViaUI — click the snapshot
    await expect(page.locator('.past-chat-item')).toBeVisible({ timeout: 10000 });
    await page.locator('.past-chat-item').click();

    // Click Share button in detail modal
    await page.getByRole('button', { name: 'Share' }).click();

    // Share modal should open — generate link
    await expect(page.getByText('Share Publicly')).toBeVisible();
    await page.locator('#generate-share-link').click();

    // Get the public URL
    const linkElement = page.locator('#share-url-text');
    await expect(linkElement).toBeVisible();
    const publicUrl = await linkElement.innerText();
    expect(publicUrl).toContain('/s/');

    // Open in a new context (no auth)
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(publicUrl);

    // Verify snapshot content is shown
    await expect(newPage.locator('h1')).toHaveText('Share Snapshot Test');
    await expect(newPage.locator('.tiptap')).toContainText('Shared snapshot content');

    // Verify snapshot badge is shown (not "Publicly Shared Document")
    // The badge text is "Snapshot" with CSS text-transform: uppercase
    await expect(newPage.getByText('Snapshot', { exact: true })).toBeVisible();

    // Verify read-only
    const tiptap = newPage.locator('.tiptap');
    await expect(tiptap).toHaveAttribute('contenteditable', 'false');

    // Verify no sidebar
    await expect(newPage.locator('.sidebar')).not.toBeVisible();

    await newContext.close();
  });
});
