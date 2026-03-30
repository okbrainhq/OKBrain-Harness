import { test, expect, request } from '@playwright/test';
import sharp from 'sharp';
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

// Create a valid 2x2 red PNG using sharp
async function createTestPNG(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  }).png().toBuffer();
}

test.describe('Image Upload API', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should upload an image and return WebP URL', async () => {
    const { context } = await createAuthContext();
    const png = await createTestPNG();

    const response = await context.fetch('/api/upload', {
      method: 'POST',
      multipart: {
        file: {
          name: 'test.png',
          mimeType: 'image/png',
          buffer: png,
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.url).toMatch(/^\/uploads\/.*\.webp$/);
    expect(data.filename).toMatch(/\.webp$/);
    expect(data.mimeType).toBe('image/webp');
    expect(data.originalName).toBe('test.png');
    expect(data.size).toBeGreaterThan(0);
  });

  test('should reject files over 10MB', async () => {
    const { context } = await createAuthContext();
    // Create a buffer just over 10MB
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);

    const response = await context.fetch('/api/upload', {
      method: 'POST',
      multipart: {
        file: {
          name: 'huge.png',
          mimeType: 'image/png',
          buffer: oversized,
        },
      },
    });

    // Server should reject with 400 (size check) or 500 (body parsing limit)
    expect(response.ok()).toBeFalsy();
  });

  test('should reject non-image files', async () => {
    const { context } = await createAuthContext();
    const textFile = Buffer.from('hello world');

    const response = await context.fetch('/api/upload', {
      method: 'POST',
      multipart: {
        file: {
          name: 'test.txt',
          mimeType: 'text/plain',
          buffer: textFile,
        },
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid file type');
  });

  test('should reject unauthenticated uploads', async () => {
    const unauthContext = await request.newContext({
      baseURL: 'http://localhost:3001',
    });
    const png = await createTestPNG();

    const response = await unauthContext.fetch('/api/upload', {
      method: 'POST',
      multipart: {
        file: {
          name: 'test.png',
          mimeType: 'image/png',
          buffer: png,
        },
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should serve uploaded file at returned URL', async () => {
    const { context } = await createAuthContext();
    const png = await createTestPNG();

    // Upload
    const uploadResponse = await context.fetch('/api/upload', {
      method: 'POST',
      multipart: {
        file: {
          name: 'serve-test.png',
          mimeType: 'image/png',
          buffer: png,
        },
      },
    });
    expect(uploadResponse.ok()).toBeTruthy();
    const data = await uploadResponse.json();

    // Serve
    const serveResponse = await context.fetch(data.url);
    expect(serveResponse.ok()).toBeTruthy();
    expect(serveResponse.headers()['content-type']).toBe('image/webp');
    expect(serveResponse.headers()['cache-control']).toContain('immutable');
  });

  test('should return 404 for non-existent file', async () => {
    const { context } = await createAuthContext();

    const response = await context.fetch('/uploads/nonexistent.webp');
    expect(response.status()).toBe(404);
  });
});

test.describe('Doc Image Upload UI', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should upload image via slash menu', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Click in editor
    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();

    // Type / to open slash menu
    await page.keyboard.type('/');
    await page.waitForTimeout(300);

    // The slash menu should be visible
    const slashMenu = page.locator('.slash-menu');
    await expect(slashMenu).toBeVisible({ timeout: 2000 });

    // Create a test PNG file for the file chooser
    const png = await createTestPNG();

    // Set up file chooser handler before clicking Image
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.slash-menu-item').filter({ hasText: 'Image' }).click(),
    ]);

    // Upload the test file
    await fileChooser.setFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: png,
    });

    // Wait for upload and image to appear
    const img = editor.locator('img.uploaded-image');
    await expect(img).toBeVisible({ timeout: 10000 });

    // Wait for the blob URL to be replaced by the server URL
    await expect(img).not.toHaveAttribute('src', /^blob:/, { timeout: 10000 });

    const src = await img.getAttribute('src');
    expect(src).toMatch(/^\/uploads\/.*\.webp$/);
  });

  test('should persist uploaded image after reload', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.tiptap-editor .tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();

    // Type / to open slash menu and select Image
    await page.keyboard.type('/');
    await page.waitForTimeout(300);

    const png = await createTestPNG();
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.slash-menu-item').filter({ hasText: 'Image' }).click(),
    ]);

    await fileChooser.setFiles({
      name: 'persist-test.png',
      mimeType: 'image/png',
      buffer: png,
    });

    // Wait for image to appear
    const img = editor.locator('img.uploaded-image');
    await expect(img).toBeVisible({ timeout: 10000 });

    // Wait for auto-save
    await page.waitForTimeout(2500);

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify image persists
    const imgAfterReload = page.locator('.tiptap-editor .tiptap img');
    await expect(imgAfterReload).toBeVisible({ timeout: 5000 });
    const src = await imgAfterReload.getAttribute('src');
    expect(src).toMatch(/^\/uploads\/.*\.webp$/);
  });
});
