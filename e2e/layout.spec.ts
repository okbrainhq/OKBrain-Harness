import { test, expect } from '@playwright/test';
import { loadTestEnv, verifyTestDb, setupPageWithUser, waitForChatCompletion, waitForApiResponse, clickNewDoc } from './test-utils';

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

test.describe('Sidebar Layout', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    // Start with a clean state
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should resize sidebar by dragging', async ({ page }) => {
    // Get initial sidebar width
    const sidebar = page.locator('.sidebar');
    const initialBox = await sidebar.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    // Find the resize handle
    const resizeHandle = page.locator('.sidebar-resize-handle');
    await expect(resizeHandle).toBeVisible();

    // Get the handle position
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Drag the handle to resize (increase width by 100px)
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 100, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    // Wait a bit for the resize to complete
    await page.waitForTimeout(100);

    // Check that the sidebar width has changed
    const newBox = await sidebar.boundingBox();
    expect(newBox).not.toBeNull();
    const newWidth = newBox!.width;

    // The width should have increased by approximately 100px (within 10px tolerance)
    expect(newWidth).toBeGreaterThan(initialWidth + 90);
    expect(newWidth).toBeLessThan(initialWidth + 110);
  });

  test('should persist sidebar width after page reload', async ({ page }) => {
    // Resize the sidebar
    const sidebar = page.locator('.sidebar');
    const resizeHandle = page.locator('.sidebar-resize-handle');

    await expect(resizeHandle).toBeVisible();

    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Drag to a specific width (increase by 150px)
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 150, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(100);

    // Get the width after resize
    const boxAfterResize = await sidebar.boundingBox();
    expect(boxAfterResize).not.toBeNull();
    const widthAfterResize = boxAfterResize!.width;

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for sidebar to be visible again
    await expect(sidebar).toBeVisible();
    await page.waitForTimeout(100);

    // Check that the width is persisted (within 5px tolerance for rendering differences)
    const boxAfterReload = await sidebar.boundingBox();
    expect(boxAfterReload).not.toBeNull();
    const widthAfterReload = boxAfterReload!.width;

    expect(widthAfterReload).toBeGreaterThan(widthAfterResize - 5);
    expect(widthAfterReload).toBeLessThan(widthAfterResize + 5);
  });

  test('should respect min and max width constraints', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const resizeHandle = page.locator('.sidebar-resize-handle');

    await expect(resizeHandle).toBeVisible();

    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Try to drag to a very small width (should be constrained to min 200px)
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(50, handleBox!.y + handleBox!.height / 2); // Try to resize to 50px
    await page.mouse.up();

    await page.waitForTimeout(100);

    const boxAfterMinResize = await sidebar.boundingBox();
    expect(boxAfterMinResize).not.toBeNull();

    // Should be constrained to minimum width (200px)
    expect(boxAfterMinResize!.width).toBeGreaterThanOrEqual(200);
    expect(boxAfterMinResize!.width).toBeLessThan(210);

    // Try to drag to a very large width (should be constrained to max 600px)
    const newHandleBox = await resizeHandle.boundingBox();
    expect(newHandleBox).not.toBeNull();

    await page.mouse.move(newHandleBox!.x + newHandleBox!.width / 2, newHandleBox!.y + newHandleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(800, newHandleBox!.y + newHandleBox!.height / 2); // Try to resize to 800px
    await page.mouse.up();

    await page.waitForTimeout(100);

    const boxAfterMaxResize = await sidebar.boundingBox();
    expect(boxAfterMaxResize).not.toBeNull();

    // Should be constrained to maximum width (600px)
    expect(boxAfterMaxResize!.width).toBeLessThanOrEqual(600);
    expect(boxAfterMaxResize!.width).toBeGreaterThan(590);
  });

  test('should show resize cursor on hover', async ({ page }) => {
    const resizeHandle = page.locator('.sidebar-resize-handle');
    await expect(resizeHandle).toBeVisible();

    // Hover over the resize handle
    await resizeHandle.hover();

    // Check that the cursor changes (via CSS)
    const cursor = await resizeHandle.evaluate((el) => {
      return window.getComputedStyle(el).cursor;
    });

    expect(cursor).toBe('ew-resize');
  });

  test('should not show resize handle when sidebar is collapsed', async ({ page }) => {
    // Collapse the sidebar
    const toggleButton = page.locator('.sidebar-toggle');
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    // Wait for collapse animation
    await page.waitForTimeout(400);

    // Resize handle should not be visible
    const resizeHandle = page.locator('.sidebar-resize-handle');
    await expect(resizeHandle).not.toBeVisible();
  });

  test('should maintain width when toggling collapse/expand', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const resizeHandle = page.locator('.sidebar-resize-handle');

    // Resize to a custom width
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 120, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(100);

    const customWidthBox = await sidebar.boundingBox();
    expect(customWidthBox).not.toBeNull();
    const customWidth = customWidthBox!.width;

    // Collapse the sidebar
    const toggleButton = page.locator('.sidebar-toggle');
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Expand the sidebar again
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Width should return to custom width
    const expandedBox = await sidebar.boundingBox();
    expect(expandedBox).not.toBeNull();

    expect(expandedBox!.width).toBeGreaterThan(customWidth - 5);
    expect(expandedBox!.width).toBeLessThan(customWidth + 5);
  });

  test('should not show resize handle on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Open the mobile sidebar
    const menuButton = page.locator('.menu-btn');
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // Wait for sidebar to open
    await page.waitForTimeout(400);

    // Resize handle should not be visible on mobile
    const resizeHandle = page.locator('.sidebar-resize-handle');
    await expect(resizeHandle).not.toBeVisible();
  });

  test('should collapse sidebar when toggle button is clicked @smoke', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar-toggle');

    // Initially sidebar should not be collapsed
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Get initial width (should be expanded)
    const initialBox = await sidebar.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;
    expect(initialWidth).toBeGreaterThan(200);

    // Click toggle to collapse
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Sidebar should have collapsed class
    await expect(sidebar).toHaveClass(/collapsed/);

    // Width should be 60px when collapsed
    const collapsedBox = await sidebar.boundingBox();
    expect(collapsedBox).not.toBeNull();
    expect(collapsedBox!.width).toBeGreaterThanOrEqual(60);
    expect(collapsedBox!.width).toBeLessThanOrEqual(65);
  });

  test('should expand sidebar when toggle button is clicked again', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar-toggle');

    // Collapse first
    await toggleButton.click();
    await page.waitForTimeout(400);
    await expect(sidebar).toHaveClass(/collapsed/);

    // Expand again
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Sidebar should not have collapsed class
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Width should be back to expanded state
    const expandedBox = await sidebar.boundingBox();
    expect(expandedBox).not.toBeNull();
    expect(expandedBox!.width).toBeGreaterThan(200);
  });

  test('should persist collapsed state after page reload', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar-toggle');

    // Collapse the sidebar
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Verify it's collapsed
    await expect(sidebar).toHaveClass(/collapsed/);
    const collapsedBox = await sidebar.boundingBox();
    expect(collapsedBox).not.toBeNull();
    expect(collapsedBox!.width).toBeLessThanOrEqual(65);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for sidebar to be visible again
    await expect(sidebar).toBeVisible();
    await page.waitForTimeout(100);

    // Sidebar should still be collapsed
    await expect(sidebar).toHaveClass(/collapsed/);
    const reloadedBox = await sidebar.boundingBox();
    expect(reloadedBox).not.toBeNull();
    expect(reloadedBox!.width).toBeLessThanOrEqual(65);
  });

  test('should persist expanded state after page reload', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar-toggle');

    // First collapse the sidebar
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Then expand it again
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Verify it's expanded
    await expect(sidebar).not.toHaveClass(/collapsed/);
    const expandedBox = await sidebar.boundingBox();
    expect(expandedBox).not.toBeNull();
    const expandedWidth = expandedBox!.width;

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for sidebar to be visible again
    await expect(sidebar).toBeVisible();
    await page.waitForTimeout(100);

    // Sidebar should still be expanded
    await expect(sidebar).not.toHaveClass(/collapsed/);
    const reloadedBox = await sidebar.boundingBox();
    expect(reloadedBox).not.toBeNull();
    expect(reloadedBox!.width).toBeGreaterThan(200);

    // Width should match (within tolerance)
    expect(reloadedBox!.width).toBeGreaterThan(expandedWidth - 5);
    expect(reloadedBox!.width).toBeLessThan(expandedWidth + 5);
  });

  test('should hide content when collapsed but show collapsed + button', async ({ page }) => {
    const toggleButton = page.locator('.sidebar-toggle');
    const logoText = page.locator('.logo span');
    const newButton = page.locator('.new-btn');
    const collapsedNewButton = page.locator('.new-btn-collapsed');

    // Initially content should be visible
    await expect(logoText).toBeVisible();
    await expect(newButton).toBeVisible();
    await expect(collapsedNewButton).not.toBeVisible();

    // Collapse the sidebar
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Logo text and expanded New button should be hidden
    await expect(logoText).not.toBeVisible();
    await expect(newButton).not.toBeVisible();

    // Collapsed + button should be visible
    await expect(collapsedNewButton).toBeVisible();
  });

  test('should show content when expanded', async ({ page }) => {
    const toggleButton = page.locator('.sidebar-toggle');
    const logoText = page.locator('.logo span');
    const newButton = page.locator('.new-btn');
    const collapsedNewButton = page.locator('.new-btn-collapsed');

    // Collapse first
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Expand again
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Content should be visible again
    await expect(logoText).toBeVisible();
    await expect(newButton).toBeVisible();
    await expect(collapsedNewButton).not.toBeVisible();
  });

  test('should change toggle button icon based on state', async ({ page }) => {
    const toggleButton = page.locator('.sidebar-toggle');

    // Initially should show collapse icon (Collapse sidebar)
    await expect(toggleButton).toHaveAttribute('title', 'Collapse sidebar');

    // Click to collapse
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Should show expand icon (Expand sidebar)
    await expect(toggleButton).toHaveAttribute('title', 'Expand sidebar');

    // Click to expand
    await toggleButton.click();
    await page.waitForTimeout(400);

    // Should show collapse icon again (Collapse sidebar)
    await expect(toggleButton).toHaveAttribute('title', 'Collapse sidebar');
  });

  test('should not have hydration mismatch when loading with collapsed state', async ({ page, context }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar-toggle');

    // Set up collapsed state
    await toggleButton.click();
    await page.waitForTimeout(400);
    await expect(sidebar).toHaveClass(/collapsed/);

    // Open a new page in the same context (to keep cookies)
    const newPage = await context.newPage();
    await newPage.goto('/');
    await newPage.waitForLoadState('networkidle');

    const newSidebar = newPage.locator('.sidebar');

    // Should load collapsed without any visual flashing
    // Check immediately (no wait) to ensure SSR rendered correctly
    await expect(newSidebar).toHaveClass(/collapsed/);

    const box = await newSidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(65);

    await newPage.close();
  });

  test('should load more sidebar items when clicking "Load More"', async ({ page }) => {
    // We need to inject enough data to trigger pagination (limit is 50 usually)
    // Since we can't easily import app code in tests often, we'll use the API or just rely on the fact that
    // we want to test the BUTTON appearing.
    // For a real test, creating 51 items via UI is slow.
    // Creating via API is faster.

    const createPromises = [];
    for (let i = 0; i < 60; i++) {
      createPromises.push(page.request.post('/api/conversations', {
        data: { title: `Chat ${i}` }
      }));
    }
    await Promise.all(createPromises);

    // Reload to refresh sidebar
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Sidebar should verify limit (approx 50 items shown initially)
    const items = page.locator('.chat-item');
    // Using default limit 50.
    // We need to verify we have ~50, maybe plus documents if any.
    // We created 60 chats.

    // Check count of items. Should be 50.
    // We might have "Today", "Yesterday" etc headers.
    // Count .chat-item elements.
    await expect(items).toHaveCount(50);

    // "Load More" button should be visible
    const loadMoreBtn = page.getByRole('button', { name: 'Load More' });
    await expect(loadMoreBtn).toBeVisible();

    // Click it
    await loadMoreBtn.click();

    // Should have more items now (60 total)
    await expect(items).toHaveCount(60);

    // Button should disappear if all loaded (we have 60, loaded 50, then 10 more. Total 60. Next fetch gives 0? No, limit 50, offset 50. We have 60. Fetch gets remaining 10. hasMore becomes false?)
    // If we have exactly 60, offset 50 gets 10. 10 < 50 => hasMore = false.
    await expect(loadMoreBtn).not.toBeVisible();
  });

  // ========== SIDEBAR GROUPING TESTS ==========

  test('should group items correctly under Last 24 Hours', async ({ page }) => {
    // Mock the sidebar items API
    await page.route('/api/sidebar/items*', async route => {
      const now = new Date();
      // Format as SQLite CURRENT_TIMESTAMP (YYYY-MM-DD HH:MM:SS) in UTC
      const pad = (n: number) => n.toString().padStart(2, '0');
      const utcString = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

      console.log(`[TEST] Mocking sidebar item with UTC time: ${utcString}`);

      await route.fulfill({
        json: [
          {
            id: 'test-chat-today',
            title: 'Created Today',
            updated_at: utcString,
            type: 'chat'
          }
        ]
      });
    });

    // Need to trigger a reload or navigate to ensure mock is used
    await page.goto('/');

    // Wait for the chat item to appear in the sidebar
    await expect(page.locator('text=Created Today')).toBeVisible();

    // We can use a more specific selector to ensure it's in the right group
    const todayGroup = page.locator('div:has(> .history-section-title:text("Last 24 Hours"))');
    await expect(todayGroup).toBeVisible();
    await expect(todayGroup.locator('text=Created Today')).toBeVisible();
  });

  test('should group items correctly under Previous 7 Days', async ({ page }) => {
    const now = new Date();
    // 48 hours ago (2 days ago), should fall into "Previous 7 Days"
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // Mock the sidebar items API
    await page.route('/api/sidebar/items*', async route => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const utcString = `${twoDaysAgo.getUTCFullYear()}-${pad(twoDaysAgo.getUTCMonth() + 1)}-${pad(twoDaysAgo.getUTCDate())} ${pad(twoDaysAgo.getUTCHours())}:${pad(twoDaysAgo.getUTCMinutes())}:${pad(twoDaysAgo.getUTCSeconds())}`;

      console.log(`[TEST] Mocking sidebar item with UTC time (2 days ago): ${utcString}`);

      await route.fulfill({
        json: [
          {
            id: 'test-chat-week',
            title: 'Created This Week',
            updated_at: utcString,
            type: 'chat'
          }
        ]
      });
    });

    await page.goto('/');

    // Wait for the chat item to appear in the sidebar
    await expect(page.locator('text=Created This Week')).toBeVisible();

    const weekGroup = page.locator('div:has(> .history-section-title:text("Previous 7 Days"))');
    await expect(weekGroup).toBeVisible();
    await expect(weekGroup.locator('text=Created This Week')).toBeVisible();
  });

  test('should group items correctly under Older', async ({ page }) => {
    const now = new Date();
    // 8 days ago
    const older = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    // Mock the sidebar items API
    await page.route('/api/sidebar/items*', async route => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const utcString = `${older.getUTCFullYear()}-${pad(older.getUTCMonth() + 1)}-${pad(older.getUTCDate())} ${pad(older.getUTCHours())}:${pad(older.getUTCMinutes())}:${pad(older.getUTCSeconds())}`;

      console.log(`[TEST] Mocking sidebar item with UTC time (Older): ${utcString}`);

      await route.fulfill({
        json: [
          {
            id: 'test-chat-older',
            title: 'Created Older',
            updated_at: utcString,
            type: 'chat'
          }
        ]
      });
    });

    await page.goto('/');

    // Wait for the chat item to appear in the sidebar
    await expect(page.locator('text=Created Older')).toBeVisible();

    const olderGroup = page.locator('div:has(> .history-section-title:text("Older"))');
    await expect(olderGroup).toBeVisible();
    await expect(olderGroup.locator('text=Created Older')).toBeVisible();
  });

  test.describe('Home Page Action Buttons', () => {
    test.beforeEach(async ({ page }) => {
      // setupPageWithUser is already called in the outer beforeEach, 
      // but let's ensure we are on home page
      await page.goto('/');
      await page.waitForLoadState('networkidle');
    });

    test('should show home action buttons on home page', async ({ page }) => {
      const openLastBtn = page.getByRole('button', { name: /Open Last/i });
      const todayNewsBtn = page.getByRole('button', { name: /Today News/i });

      await expect(openLastBtn).toBeVisible({ timeout: 10000 });
      await expect(todayNewsBtn).toBeVisible({ timeout: 10000 });
    });

    test('should hide home action buttons on chat page', async ({ page }) => {
      // Create a chat first
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.waitFor({ timeout: 10000 });
      await input.fill('Hello');
      await input.press('Enter');

      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      await waitForChatCompletion(page);

      const openLastBtn = page.getByRole('button', { name: /Open Last/i });
      const todayNewsBtn = page.getByRole('button', { name: /Today News/i });

      await expect(openLastBtn).not.toBeVisible();
      await expect(todayNewsBtn).not.toBeVisible();
    });

    test('should navigate to latest chat and scroll to bottom with "Open Last"', async ({ page }) => {
      // 1. Create a chat with many messages to test scrolling
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.waitFor({ timeout: 10000 });
      await input.fill('First message');
      await input.press('Enter');

      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      await waitForChatCompletion(page);

      for (let i = 0; i < 2; i++) {
        const nextInput = page.locator('textarea[placeholder="Ask me anything..."]');
        await nextInput.fill(`Follow up message ${i}`);
        await nextInput.press('Enter');
        await waitForChatCompletion(page);
      }

      const lastMessage = page.locator('text=Follow up message 1');
      await expect(lastMessage).toBeVisible();

      // 2. Go home
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 3. Click Open Last
      const openLastBtn = page.getByRole('button', { name: /Open Last/i });
      await openLastBtn.click();

      // 4. Verify navigation
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });

      // 5. Verify it's at the bottom
      await page.waitForTimeout(1000);
      const isInViewport = await lastMessage.isVisible();
      expect(isInViewport).toBeTruthy();

      // Check if scrolled
      const scrollTop = await page.evaluate(() => {
        const container = document.querySelector('.messages-container');
        console.log('ScrollTop:', container?.scrollTop);
        return container?.scrollTop || 0;
      });
      expect(scrollTop).toBeGreaterThan(0);
    });

    test('should NOT scroll to bottom when navigating from sidebar', async ({ page }) => {
      // 1. Create a chat with many messages
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.waitFor({ timeout: 10000 });
      await input.fill('First message');
      await input.press('Enter');

      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      await waitForChatCompletion(page);

      for (let i = 0; i < 2; i++) {
        const nextInput = page.locator('textarea[placeholder="Ask me anything..."]');
        await nextInput.fill(`Follow up message ${i}`);
        await nextInput.press('Enter');
        await waitForChatCompletion(page);
      }

      const firstMessage = page.locator('.message.user').first();
      const lastMessage = page.locator('text=Follow up message 1');

      // 2. Go home
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 3. Click the conversation in the sidebar
      const sidebarItem = page.locator('.chat-item').first();
      await sidebarItem.click();

      // 4. Verify navigation
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });

      // 5. Verify it's at the TOP
      await page.waitForTimeout(1000);

      // First message should be exactly visible (or at least partially)
      const isFirstVisible = await firstMessage.isVisible();
      expect(isFirstVisible).toBeTruthy();

      // Check if NOT scrolled
      const scrollTop = await page.evaluate(() => {
        return document.querySelector('.messages-container')?.scrollTop || 0;
      });
      // It should be 0 or very close to it (sometimes browsers have minor offsets, but usually 0 on load)
      expect(scrollTop).toBeLessThan(50);
    });

    test('should start a news search with "Today News"', async ({ page }) => {
      const todayNewsBtn = page.getByRole('button', { name: /Today News/i });
      await todayNewsBtn.click();

      // Should navigate to a new chat
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });

      // Check if the prompt was sent
      const userMessage = page.locator('.message.user').first();
      await expect(userMessage).toContainText(/Analyze the top 10 most impactful global news stories/i, { timeout: 10000 });

      // Check if THINK checkbox is visible (it's the only checkbox now)
      const thinkCheckbox = page.locator('input[type="checkbox"]');
      await expect(thinkCheckbox).toBeVisible();
    });

    test('should open last document with "Open Last" when doc was last opened', async ({ page }) => {
      // 1. Create a document
      await clickNewDoc(page);
      await page.waitForURL(/\/doc\//, { timeout: 10000 });

      // Verify doc page loaded
      const titleInput = page.locator('.document-title-input');
      await expect(titleInput).toBeVisible({ timeout: 5000 });

      // Capture doc URL
      const docUrl = page.url();
      const docId = docUrl.match(/\/doc\/([^?]+)/)?.[1];
      expect(docId).toBeTruthy();

      // 2. Go home
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 3. Click Open Last - should navigate to the document
      const openLastBtn = page.getByRole('button', { name: /Open Last/i });
      await expect(openLastBtn).toBeVisible({ timeout: 10000 });
      await openLastBtn.click();

      // 4. Verify navigation to the document
      await page.waitForURL(/\/doc\//, { timeout: 15000 });
      expect(page.url()).toContain(`/doc/${docId}`);

      // Verify doc page content is loaded
      await expect(page.locator('.document-title-input')).toBeVisible({ timeout: 5000 });
    });

    test('should open last chat even after doc if chat was opened more recently', async ({ page }) => {
      // 1. Create a document first
      await clickNewDoc(page);
      await page.waitForURL(/\/doc\//, { timeout: 10000 });
      await expect(page.locator('.document-title-input')).toBeVisible({ timeout: 5000 });

      // 2. Go home and create a chat (which becomes the more recent item)
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.waitFor({ timeout: 10000 });
      await input.fill('Test message after doc');
      await input.press('Enter');
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      await waitForChatCompletion(page);

      const chatUrl = page.url();

      // 3. Go home and click Open Last
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const openLastBtn = page.getByRole('button', { name: /Open Last/i });
      await expect(openLastBtn).toBeVisible({ timeout: 10000 });
      await openLastBtn.click();

      // 4. Should navigate to the chat (not the doc) since chat was opened more recently
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      expect(page.url()).toContain(chatUrl.match(/\/chat\/([^?]+)/)?.[1] || '');
    });

    test('should restore scroll position when using "Open Last"', async ({ page }) => {
      test.setTimeout(60000);

      // 1. Create a chat with a couple of messages
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.waitFor({ timeout: 10000 });
      await input.fill('First message');
      await input.press('Enter');

      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      await waitForChatCompletion(page);

      const nextInput = page.locator('textarea[placeholder="Ask me anything..."]');
      await nextInput.fill('Follow up message');
      await nextInput.press('Enter');
      await waitForChatCompletion(page);

      // 2. Scroll to the top manually
      await page.evaluate(() => {
        const container = document.querySelector('.messages-container');
        if (container) container.scrollTop = 0;
      });
      // Wait for debounced scroll position save (300ms debounce + buffer)
      await page.waitForTimeout(500);

      // Verify we're at the top
      const scrollTopBefore = await page.evaluate(() => {
        return document.querySelector('.messages-container')?.scrollTop || 0;
      });
      expect(scrollTopBefore).toBe(0);

      // 3. Go home
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 4. Click Open Last
      const openLastBtn = page.getByRole('button', { name: /Open Last/i });
      await openLastBtn.click();

      // 5. Verify navigation
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });
      await page.waitForTimeout(500);

      // 6. Should restore scroll to top (position 0), NOT scroll to bottom
      const scrollTopAfter = await page.evaluate(() => {
        return document.querySelector('.messages-container')?.scrollTop || 0;
      });
      expect(scrollTopAfter).toBeLessThan(50);

      // First message should be visible (we're at the top)
      const firstMessage = page.locator('.message.user').first();
      await expect(firstMessage).toBeVisible();
    });
  });

});

test.describe('User Preferences Persistence', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test.describe('THINK Checkbox', () => {
    test('should persist THINK enabled state when navigating to a new chat', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Verify THINK checkbox is checked by default
      const thinkCheckbox = page.locator('input[type="checkbox"]');
      await expect(thinkCheckbox).toBeVisible();
      await expect(thinkCheckbox).toBeChecked();

      // Send a message to create a conversation
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.fill('Hello');

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');
      await responsePromise;
      await waitForChatCompletion(page);

      // Navigate to home (new chat)
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Verify THINK is still enabled
      await expect(thinkCheckbox).toBeChecked();
    });

    test('should persist THINK disabled state when navigating to a new chat', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Uncheck THINK
      const thinkCheckbox = page.locator('input[type="checkbox"]');
      await expect(thinkCheckbox).toBeVisible();
      await thinkCheckbox.uncheck();
      await expect(thinkCheckbox).not.toBeChecked();

      // Send a message to create a conversation
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.fill('Hello');

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');
      await responsePromise;
      await waitForChatCompletion(page);

      // Navigate to home (new chat)
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Verify THINK is still disabled
      await expect(thinkCheckbox).not.toBeChecked();
    });

    test('should persist THINK state after page reload', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Uncheck THINK
      const thinkCheckbox = page.locator('input[type="checkbox"]');
      await expect(thinkCheckbox).toBeVisible();
      await thinkCheckbox.uncheck();
      await expect(thinkCheckbox).not.toBeChecked();

      // Wait for preference to be saved
      await page.waitForTimeout(500);

      // Reload the page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify THINK is still disabled
      await expect(thinkCheckbox).not.toBeChecked();
    });
  });

  test.describe('AI Provider Selection', () => {
    test('should default to Gemini 3 Flash @smoke', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const providerSelect = page.locator('#ai-provider');
      await expect(providerSelect).toHaveValue('gemini');
    });

    test('should persist AI provider change after reload', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Change to Grok
      const providerSelect = page.locator('#ai-provider');
      await providerSelect.selectOption('xai');
      await expect(providerSelect).toHaveValue('xai');

      // Wait for preference to be saved
      await page.waitForTimeout(500);

      // Reload the page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify provider is still Grok
      await expect(providerSelect).toHaveValue('xai');
    });

    test('should not overwrite preferred model when opening a conversation with a different model', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const providerSelect = page.locator('#ai-provider');

      // Disable thinking for faster responses
      const thinkCheckbox = page.locator('input[type="checkbox"]');
      await thinkCheckbox.uncheck();

      // Create a conversation with the default model (Gemini Flash)
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.fill('Hello');

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');
      await responsePromise;
      await waitForChatCompletion(page);

      // Change preferred model to Grok
      await providerSelect.selectOption('xai');
      await page.waitForTimeout(500);

      // Open the Gemini Flash conversation via sidebar
      const sidebarItem = page.locator('.chat-item').first();
      await sidebarItem.click();
      await page.waitForURL(/\/chat\/.+/, { timeout: 15000 });

      // The model selector should show gemini (conversation's model)
      await expect(providerSelect).toHaveValue('gemini');

      // Go home — the preferred model should still be Grok
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(providerSelect).toHaveValue('xai');
    });

    test('should persist AI provider change when navigating to chat and back', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Change to Gemini 3 Flash
      const providerSelect = page.locator('#ai-provider');
      await providerSelect.selectOption('gemini');
      await expect(providerSelect).toHaveValue('gemini');

      // Send a message to create a conversation
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.fill('Hello');

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');
      await responsePromise;
      await waitForChatCompletion(page);

      // Navigate to home
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Verify provider is still Gemini 3 Flash
      await expect(providerSelect).toHaveValue('gemini');
    });
  });

  test.describe('Response Mode Selection', () => {
    test('should default to Detailed mode', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const modeSelect = page.locator('#response-mode');
      await expect(modeSelect).toHaveValue('detailed');
    });

    test('should persist response mode change after reload', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Change to Quick mode
      const modeSelect = page.locator('#response-mode');
      await modeSelect.selectOption('quick');
      await expect(modeSelect).toHaveValue('quick');

      // Wait for preference to be saved
      await page.waitForTimeout(500);

      // Reload the page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify mode is still Quick
      await expect(modeSelect).toHaveValue('quick');
    });

    test('should persist response mode change when navigating to chat and back', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Change to Quick mode
      const modeSelect = page.locator('#response-mode');
      await modeSelect.selectOption('quick');
      await expect(modeSelect).toHaveValue('quick');

      // Send a message to create a conversation
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.fill('Hello');

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');
      await responsePromise;
      await waitForChatCompletion(page);

      // Navigate to home
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Verify mode is still Quick
      await expect(modeSelect).toHaveValue('quick');
    });
  });

  test.describe('Verify Model Selection', () => {
    test('should persist verify model selection', async ({ page }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Send a message first to get to a chat page where verify button appears
      const input = page.locator('textarea[placeholder="Ask me anything..."]');
      await input.fill('Hello');

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');
      await responsePromise;
      await waitForChatCompletion(page);

      // Wait for verify split button to be visible
      const verifyButtonMain = page.locator('.verify-button-main');
      await expect(verifyButtonMain).toBeVisible();

      // Open the dropdown menu
      const arrowButton = page.locator('.verify-button-arrow');
      await arrowButton.click();

      // Click "Gemini 3.1 Pro" option
      const geminiProOption = page.locator('button:has-text("Gemini 3.1 Pro")');
      await geminiProOption.click();

      // Wait for preference to be saved and UI to update
      await page.waitForTimeout(500);

      // Verify the main button text updated
      await expect(verifyButtonMain).toContainText('Verify with Gemini 3.1 Pro');

      // Reload the page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Wait for verifies button to be visible
      await expect(verifyButtonMain).toBeVisible();

      // Verify the selection is still Gemini 3.1 Pro
      await expect(verifyButtonMain).toContainText('Verify with Gemini 3.1 Pro');
    });
  });

  test.describe('SSR Hydration', () => {
    test('should not have hydration mismatch with AI provider preference', async ({ page, context }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Change to Grok
      const providerSelect = page.locator('#ai-provider');
      await providerSelect.selectOption('xai');

      // Wait for preference to be saved
      await page.waitForTimeout(500);

      // Open a new page in the same context
      const newPage = await context.newPage();
      await newPage.goto('/');
      await newPage.waitForLoadState('networkidle');

      // Provider should be Grok immediately (no flash to default)
      const newProviderSelect = newPage.locator('#ai-provider');
      await expect(newProviderSelect).toHaveValue('xai');

      await newPage.close();
    });

    test('should not have hydration mismatch with response mode preference', async ({ page, context }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Change to Quick mode
      const modeSelect = page.locator('#response-mode');
      await modeSelect.selectOption('quick');

      // Wait for preference to be saved
      await page.waitForTimeout(500);

      // Open a new page in the same context
      const newPage = await context.newPage();
      await newPage.goto('/');
      await newPage.waitForLoadState('networkidle');

      // Mode should be Quick immediately (no flash to default)
      const newModeSelect = newPage.locator('#response-mode');
      await expect(newModeSelect).toHaveValue('quick');

      await newPage.close();
    });

    test('should not have hydration mismatch with THINK preference', async ({ page, context }) => {
      await setupPageWithUser(page);
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Uncheck THINK
      const thinkCheckbox = page.locator('input[type="checkbox"]');
      await thinkCheckbox.uncheck();

      // Wait for preference to be saved
      await page.waitForTimeout(500);

      // Open a new page in the same context
      const newPage = await context.newPage();
      await newPage.goto('/');
      await newPage.waitForLoadState('networkidle');

      // THINK should be unchecked immediately (no flash to default)
      const newThinkCheckbox = newPage.locator('input[type="checkbox"]');
      await expect(newThinkCheckbox).not.toBeChecked();

      await newPage.close();
    });
  });

  test.describe('Mobile Header Navigation', () => {
    test.use({ viewport: { width: 375, height: 667 } });
    test.beforeEach(async ({ page }) => {
      await setupPageWithUser(page);
    });

    test('clicking logo should navigate to home', async ({ page }) => {
      // Navigate to a non-home page (e.g., /me)
      await page.goto('/me');
      await page.waitForLoadState('networkidle');

      // Verify we are on /me
      expect(page.url()).toContain('/me');

      // Find the mobile header logo and click it
      // The logo is in .mobile-header .logo
      const logo = page.locator('.mobile-header .logo');
      await expect(logo).toBeVisible();

      await logo.click();

      // Verify we are back on home page
      await page.waitForURL((url) => {
        return url.pathname === '/';
      });

      expect(new URL(page.url()).pathname).toBe('/');
    });
  });
});

test.describe('Sidebar Search', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should search for document and navigate to it', async ({ page }) => {
    // Create a document via API
    const response = await page.request.post('/api/docs', {
      data: { title: 'My Important Project Notes' }
    });
    expect(response.ok()).toBeTruthy();
    const doc = await response.json();

    // Reload to refresh sidebar
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Search for the document
    const searchInput = page.locator('input.search-input');
    await searchInput.fill('Project Notes');
    await page.waitForTimeout(400);

    // Click on the document result
    const docResult = page.locator('.search-results .chat-item').filter({ hasText: 'My Important Project Notes' });
    await docResult.click();

    // Should navigate to the document
    await page.waitForURL(`/doc/${doc.id}`, { timeout: 10000 });
    expect(page.url()).toContain(`/doc/${doc.id}`);

    // Verify the document loaded
    await expect(page.locator('.document-title-input')).toBeVisible();
  });

  test('should search for chat and navigate to it', async ({ page }) => {
    // Create a conversation via API
    const response = await page.request.post('/api/conversations', {
      data: { title: 'Brainstorming Ideas Chat' }
    });
    expect(response.ok()).toBeTruthy();
    const conv = await response.json();

    // Reload to refresh sidebar
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Search for the chat
    const searchInput = page.locator('input.search-input');
    await searchInput.fill('Brainstorming');
    await page.waitForTimeout(400);

    // Click on the chat result
    const chatResult = page.locator('.search-results .chat-item').filter({ hasText: 'Brainstorming Ideas Chat' });
    await chatResult.click();

    // Should navigate to the chat
    await page.waitForURL(`/chat/${conv.id}`, { timeout: 10000 });
    expect(page.url()).toContain(`/chat/${conv.id}`);

    // Verify the chat loaded
    await expect(page.locator('.messages-container')).toBeVisible();
  });

  test('should search for chat by linked fact', async ({ page }) => {
    const Database = require('better-sqlite3');
    const { v4: uuidv4 } = require('uuid');
    const dbPath = require('path').resolve(process.env.TEST_DB_PATH || 'brain.test.db');

    // Create a conversation with a generic title (won't match search)
    const response = await page.request.post('/api/conversations', {
      data: { title: 'Random Chat' }
    });
    expect(response.ok()).toBeTruthy();
    const conv = await response.json();

    // Get the user ID from the conversation
    const db = new Database(dbPath);
    const row = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(conv.id);
    const userId = row.user_id;

    // Insert a fact and link it to the conversation via fact_extractions
    const factId = uuidv4();
    db.prepare(
      'INSERT INTO facts (id, user_id, category, fact, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(factId, userId, 'core', 'Loves playing mass effect trilogy', new Date().toISOString());

    db.prepare(
      'INSERT INTO fact_extractions (id, fact_id, conversation_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), factId, conv.id, new Date().toISOString());

    db.pragma('wal_checkpoint(FULL)');
    db.close();

    // Reload to refresh sidebar
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Search for the fact text (not the title)
    const searchInput = page.locator('input.search-input');
    await searchInput.fill('mass effect');
    await page.waitForTimeout(400);

    // The conversation should appear in results
    const chatResult = page.locator('.search-results .chat-item').filter({ hasText: 'Random Chat' });
    await expect(chatResult).toBeVisible({ timeout: 5000 });

    // Click on it and verify navigation
    await chatResult.click();
    await page.waitForURL(`/chat/${conv.id}`, { timeout: 10000 });
    expect(page.url()).toContain(`/chat/${conv.id}`);
  });
});
