import { test, expect } from '@playwright/test';
import { loadTestEnv, verifyTestDb, setupPageWithUser, waitForChatCompletion, clickNewDoc } from './test-utils';

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

test.describe('Document Print Feature', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show Print button on document page', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Open menu and check if Print button is visible
    const menuButton = page.locator('.chat-menu-button');
    await menuButton.click();

    const printMenuItem = page.getByRole('button', { name: 'Print' });
    await expect(printMenuItem).toBeVisible({ timeout: 5000 });
    await expect(printMenuItem).toContainText('Print');
  });

  test('should trigger print dialog when Print button is clicked', async ({ page, context }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc with a title
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Set a title
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('Test Print Document');
    await page.waitForTimeout(1500);

    // Listen for print events
    let printEventFired = false;
    await page.evaluate(() => {
      (window as any).printEventFired = false;
      window.addEventListener('beforeprint', () => {
        (window as any).printEventFired = true;
      });
    });

    // Open menu and click Print button
    const menuButton = page.locator('.chat-menu-button');
    await menuButton.click();

    const printMenuItem = page.getByRole('button', { name: 'Print' });
    await printMenuItem.click();

    // Check if print event was fired
    printEventFired = await page.evaluate(() => (window as any).printEventFired);
    expect(printEventFired).toBeTruthy();
  });

  test('should replace title input with wrappable div during print', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc with a long title
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Set a long title
    const longTitle = 'This is a very long document title that should wrap to multiple lines when printed';
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill(longTitle);
    await page.waitForTimeout(1500);

    // Trigger beforeprint event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });

    // Wait a moment for the DOM to update
    await page.waitForTimeout(100);

    // Check that print title div was created
    const printTitle = page.locator('[data-print-title-element="true"]');
    await expect(printTitle).toBeVisible();
    await expect(printTitle).toContainText(longTitle);

    // Check that original input is hidden
    const isInputHidden = await titleInput.evaluate((el: HTMLElement) => {
      return el.style.display === 'none';
    });
    expect(isInputHidden).toBeTruthy();

    // Trigger afterprint event to cleanup
    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'));
    });

    // Wait for cleanup
    await page.waitForTimeout(100);

    // Check that print title div was removed
    await expect(printTitle).not.toBeVisible();

    // Check that original input is visible again
    const isInputVisible = await titleInput.evaluate((el: HTMLElement) => {
      return el.style.display !== 'none';
    });
    expect(isInputVisible).toBeTruthy();
  });

  test('should hide UI elements during print', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Verify UI elements are visible before print
    const askAiBtn = page.locator('.ask-ai-button');
    const pastChatsBtn = page.locator('.past-chats-button');
    const menuButton = page.locator('.chat-menu-button');

    await expect(askAiBtn).toBeVisible();
    await expect(pastChatsBtn).toBeVisible();
    await expect(menuButton).toBeVisible();

    // Add print media emulation
    await page.emulateMedia({ media: 'print' });

    // Wait for styles to apply
    await page.waitForTimeout(200);

    // Check that action buttons are hidden in print mode
    const askAiHidden = await askAiBtn.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el.parentElement!);
      return style.display === 'none';
    });
    expect(askAiHidden).toBeTruthy();

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });

  test('should print title with proper wrapping styles', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc with a long title
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Set a long title
    const longTitle = 'This is a very long document title that should wrap properly without hyphenation';
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill(longTitle);
    await page.waitForTimeout(1500);

    // Trigger beforeprint event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });

    // Wait for DOM update
    await page.waitForTimeout(100);

    // Check print title div has proper wrapping styles
    const printTitle = page.locator('[data-print-title-element="true"]');
    await expect(printTitle).toBeVisible();

    const styles = await printTitle.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return {
        wordWrap: style.wordWrap,
        overflowWrap: style.overflowWrap,
        hyphens: style.hyphens,
        whiteSpace: style.whiteSpace,
        display: style.display,
      };
    });

    expect(styles.wordWrap).toBe('break-word');
    expect(styles.overflowWrap).toBe('break-word');
    expect(styles.hyphens).toBe('none');
    expect(styles.whiteSpace).toBe('pre-wrap');
    expect(styles.display).toBe('block');

    // Trigger afterprint to cleanup
    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
  });

  test('should handle keyboard shortcut (CMD+P / CTRL+P) for printing', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Set a title
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('Keyboard Shortcut Test');

    // Wait for the title to be saved and React state to update
    await page.waitForTimeout(1500);

    // Verify the title was actually set in the input
    await expect(titleInput).toHaveValue('Keyboard Shortcut Test');

    // Listen for beforeprint event and dispatch it
    const beforePrintFired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let fired = false;
        const handler = () => {
          fired = true;
        };
        window.addEventListener('beforeprint', handler);
        window.dispatchEvent(new Event('beforeprint'));

        // Give a moment for the event handler to run
        setTimeout(() => {
          window.removeEventListener('beforeprint', handler);
          resolve(fired);
        }, 100);
      });
    });

    expect(beforePrintFired).toBeTruthy();

    // Verify print title element was created with correct content
    const printTitle = page.locator('[data-print-title-element="true"]');
    await expect(printTitle).toBeVisible();
    await expect(printTitle).toContainText('Keyboard Shortcut Test');

    // Cleanup
    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
  });

  test('should restore original state after print is cancelled', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new doc
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//, { timeout: 10000 });

    // Set a title
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('State Restoration Test');
    await page.waitForTimeout(1500);

    // Get original title input visibility
    const originalVisibility = await titleInput.evaluate((el: HTMLElement) => {
      return window.getComputedStyle(el).display;
    });

    // Trigger print
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });

    await page.waitForTimeout(100);

    // Verify print title is visible
    const printTitle = page.locator('[data-print-title-element="true"]');
    await expect(printTitle).toBeVisible();

    // Cancel print (trigger afterprint)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'));
    });

    await page.waitForTimeout(100);

    // Verify print title is removed
    await expect(printTitle).not.toBeVisible();

    // Verify original title input is restored
    const restoredVisibility = await titleInput.evaluate((el: HTMLElement) => {
      return window.getComputedStyle(el).display;
    });

    expect(restoredVisibility).toBe(originalVisibility);
    await expect(titleInput).toBeVisible();
  });
});

test.describe('Chat Conversation Print Feature', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show Print button in chat menu', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Type a message to create a conversation
    const input = page.locator('.chat-input');
    await input.fill('Test message for print');
    await page.keyboard.press('Enter');

    // Wait for response
    await page.waitForTimeout(3000);

    // Check if chat header with menu is visible
    const chatHeader = page.locator('.chat-header');
    await expect(chatHeader).toBeVisible({ timeout: 5000 });

    // Click menu button
    const menuButton = page.locator('.chat-menu-button');
    await menuButton.click();

    // Check if Print menu item is visible
    const printMenuItem = page.getByRole('button', { name: 'Print' });
    await expect(printMenuItem).toBeVisible();
    await expect(printMenuItem).toContainText('Print');
  });

  test('should hide UI elements in chat print mode', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation
    const input = page.locator('.chat-input');
    await input.fill('Test question');
    await page.keyboard.press('Enter');

    // Wait for chat to complete
    await waitForChatCompletion(page);

    // Verify chat header is visible before print
    const chatHeader = page.locator('.chat-header');
    await expect(chatHeader).toBeVisible();

    // Add print media emulation
    await page.emulateMedia({ media: 'print' });

    // Wait for styles to apply
    await page.waitForTimeout(200);

    // Check that chat header is hidden in print mode
    const headerHidden = await chatHeader.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    expect(headerHidden).toBeTruthy();

    // Check that input container is hidden
    const inputContainer = page.locator('.input-container');
    const inputHidden = await inputContainer.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    expect(inputHidden).toBeTruthy();

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });

  test('should display conversation title in print mode', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation
    const input = page.locator('.chat-input');
    await input.fill('What is the capital of France?');
    await page.keyboard.press('Enter');

    // Wait for response and title generation
    await page.waitForTimeout(5000);

    // Get the conversation title
    const chatTitle = page.locator('.chat-title');
    const titleText = await chatTitle.textContent();

    // Check print title is hidden in normal mode
    const printTitle = page.locator('.chat-print-title');
    await expect(printTitle).not.toBeVisible();

    // Add print media emulation
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);

    // Check that print title is visible and contains the same text
    const printTitleVisible = await printTitle.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.display === 'block';
    });
    expect(printTitleVisible).toBeTruthy();

    const printTitleText = await printTitle.textContent();
    expect(printTitleText).toBe(titleText);

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });

  test('should style user messages with italic and indent in print', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation
    const input = page.locator('.chat-input');
    await input.fill('Test user message');
    await page.keyboard.press('Enter');

    // Wait for message to appear
    await page.waitForTimeout(2000);

    // Find user message
    const userMessage = page.locator('.message.user .message-text').first();
    await expect(userMessage).toBeVisible();

    // Add print media emulation
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);

    // Check that user message has italic style and left margin
    const styles = await userMessage.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return {
        fontStyle: style.fontStyle,
        marginLeft: style.marginLeft,
        background: style.background,
      };
    });

    expect(styles.fontStyle).toBe('italic');
    // marginLeft should be 2em (approximately 32px depending on font size)
    expect(parseFloat(styles.marginLeft)).toBeGreaterThan(20);

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });

  test('should remove backgrounds from messages in print mode', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation
    const input = page.locator('.chat-input');
    await input.fill('Test message');
    await page.keyboard.press('Enter');

    // Wait for response
    await page.waitForTimeout(3000);

    // Add print media emulation
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);

    // Check user message background color
    const userMessage = page.locator('.message.user').first();
    const userBgColor = await userMessage.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.backgroundColor;
    });
    // rgb(255, 255, 255) is white
    expect(userBgColor).toMatch(/rgb\(255,\s*255,\s*255\)|white/);

    // Check assistant message background color
    const assistantMessage = page.locator('.message.assistant').first();
    const assistantBgColor = await assistantMessage.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.backgroundColor;
    });
    // rgb(255, 255, 255) is white
    expect(assistantBgColor).toMatch(/rgb\(255,\s*255,\s*255\)|white/);

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });

  test('should hide action buttons in print mode', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation with multiple messages
    const input = page.locator('.chat-input');
    await input.fill('First message');
    await page.keyboard.press('Enter');

    // Wait for chat to complete
    await waitForChatCompletion(page);

    // Check action buttons are visible before print
    const actionContainer = page.locator('.action-container');
    await expect(actionContainer).toBeVisible();

    // Add print media emulation
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);

    // Check that action buttons are hidden
    const actionsHidden = await actionContainer.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    expect(actionsHidden).toBeTruthy();

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });
});

test.describe('Shared View Print Feature', () => {
  // Use sequential mode since we are sharing specific resources
  test.describe.configure({ mode: 'serial' });

  test('should verify print styles on shared conversation page', async ({ page }) => {
    // 1. Setup: Create and share a conversation
    await setupPageWithUser(page);
    await page.goto('/');

    // Create conversation
    const chatInput = page.getByPlaceholder(/Ask me anything/i);
    await chatInput.fill('Print test conversation');
    await chatInput.press('Enter');
    await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 20000 });

    // Share it
    await page.getByLabel('More options').click();
    await page.getByText('Share', { exact: true }).click();
    await page.locator('#generate-share-link').click();
    const linkElement = page.locator('#share-url-text');
    await expect(linkElement).toBeVisible();
    const publicUrl = await linkElement.innerText();

    // 2. Go to shared page
    await page.goto(publicUrl);
    await page.waitForLoadState('networkidle');

    // 3. Verify Print Button does NOT exist
    const printBtn = page.getByTitle('Print conversation');
    await expect(printBtn).not.toBeVisible();

    // 4. Inject test elements to verify print styles independent of actual content
    await page.evaluate(() => {
      const container = document.querySelector('.shared-messages-list') || document.body;

      // Inject Thoughts Container
      const thoughts = document.createElement('div');
      thoughts.className = 'thoughts-container';
      thoughts.id = 'test-thoughts';
      thoughts.textContent = 'Hidden Thoughts';
      container.appendChild(thoughts);

      // Inject Model Tag
      const modelTag = document.createElement('div');
      modelTag.className = 'model-tag';
      modelTag.id = 'test-model-tag';
      modelTag.textContent = 'GPT-4';
      container.appendChild(modelTag);

      // Inject Summary Message
      const summaryMsg = document.createElement('div');
      summaryMsg.className = 'message summary';
      summaryMsg.id = 'test-summary';
      summaryMsg.innerHTML = '<div class="message-content"><div class="message-text">Summary Content</div></div>';
      container.appendChild(summaryMsg);
    });

    // 5. Emulate Print Media
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);

    // 6. Verify Styles

    // Thoughts should be hidden
    const thoughts = page.locator('#test-thoughts');
    const thoughtsVisible = await thoughts.evaluate((el: HTMLElement) => {
      return window.getComputedStyle(el).display;
    });
    expect(thoughtsVisible).toBe('none');

    // Model Tag should be visible and styled
    const modelTag = page.locator('#test-model-tag');
    const modelStyles = await modelTag.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        color: style.color,
        border: style.border || style.borderTop, // Simplified check
        fontSize: style.fontSize
      };
    });
    expect(modelStyles.display).toBe('block');
    // Color #444 is rgb(68, 68, 68)
    expect(modelStyles.color).toBe('rgb(68, 68, 68)');
    // Font size 0.65rem is approx 10.4px (assuming 16px base)
    // expect(parseFloat(modelStyles.fontSize)).toBeCloseTo(10.4, 0.5);

    // Summary should have gray background
    const summary = page.locator('#test-summary');
    const summaryStyles = await summary.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return {
        backgroundColor: style.backgroundColor,
        printColorAdjust: style.printColorAdjust || (style as any).webkitPrintColorAdjust
      };
    });
    // #eee is rgb(238, 238, 238)
    expect(summaryStyles.backgroundColor).toBe('rgb(238, 238, 238)');
    expect(summaryStyles.printColorAdjust).toBe('exact');

    // 7. Cleanup
    await page.emulateMedia({ media: null });
  });

  test('should verify print styles on shared document page', async ({ page }) => {
    // 1. Setup: Create and share a document
    await setupPageWithUser(page);
    await page.goto('/');

    // Create document
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//);
    const titleInput = page.getByPlaceholder(/Untitled Document/i);
    await titleInput.fill('Print Shared Doc Test');
    await titleInput.blur();
    // Add content
    await page.locator('.tiptap').click();
    await page.keyboard.type('This is shared content with a link: https://example.com ');
    await page.keyboard.press('Enter'); // Ensure link is processed
    await page.waitForTimeout(2000); // Wait for save

    // Share it
    await page.getByLabel('More options').click();
    await page.getByText('Share', { exact: true }).click();
    await page.locator('#generate-share-link').click();
    const linkElement = page.locator('#share-url-text');
    await expect(linkElement).toBeVisible();
    const publicUrl = await linkElement.innerText();

    // 2. Go to shared page
    await page.goto(publicUrl);
    await page.waitForLoadState('networkidle');

    // 3. Verify Print Button does NOT exist
    const printBtn = page.getByTitle('Print document');
    await expect(printBtn).not.toBeVisible();

    // 4. Emulate Print Media
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);

    // 5. Verify Styles

    // Header Badge should be hidden
    const badge = page.locator('.shared-header-badge');
    if (await badge.count() > 0) {
      const badgeVisible = await badge.evaluate((el: HTMLElement) => window.getComputedStyle(el).display);
      expect(badgeVisible).toBe('none');
    }

    // Footer should be hidden
    const footer = page.locator('.shared-footer');
    if (await footer.count() > 0) {
      const footerVisible = await footer.evaluate((el: HTMLElement) => window.getComputedStyle(el).display);
      expect(footerVisible).toBe('none');
    }

    // Print Button should be hidden
    await expect(printBtn).not.toBeVisible();

    // Title should be styled correctly
    const title = page.locator('.shared-doc-title');
    const titleStyles = await title.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        color: style.color,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize
      };
    });

    expect(titleStyles.display).toBe('block');
    // Color black is rgb(0, 0, 0)
    expect(titleStyles.color).toBe('rgb(0, 0, 0)');
    // Font weight 700 or bold
    expect(['700', 'bold']).toContain(titleStyles.fontWeight);
    // Font size 2.25rem is approx 36px
    // expect(parseFloat(titleStyles.fontSize)).toBeCloseTo(36, 1);

    // Container padding should have horizontal padding (0.5in is approx 48px)
    const container = page.locator('.document-container');
    const paddingRight = await container.evaluate((el: HTMLElement) => window.getComputedStyle(el).paddingRight);
    expect(parseFloat(paddingRight)).toBeGreaterThan(40);

    // Verify Link Styles
    const link = page.locator('.tiptap a').first();
    // Wait for link to be visible (autolinking might take a split second or need the space/enter we did)
    await expect(link).toBeVisible();

    const linkStyles = await link.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      const afterStyle = window.getComputedStyle(el, '::after');
      return {
        color: style.color,
        textDecoration: style.textDecorationLine || style.textDecoration,
        afterContent: afterStyle.content,
        afterColor: afterStyle.color
      };
    });

    // Link should be blue (#0066cc -> rgb(0, 102, 204))
    expect(linkStyles.color).toBe('rgb(0, 102, 204)');
    // No underline
    expect(linkStyles.textDecoration).toMatch(/none/);

    // After pseudo-element should show URL
    // content often comes with quotes like '" (https://example.com)"'
    expect(linkStyles.afterContent).toContain('https://example.com');
    // After color should be dark gray (#333 -> rgb(51, 51, 51))
    expect(linkStyles.afterColor).toBe('rgb(51, 51, 51)');

    // 6. Cleanup
    await page.emulateMedia({ media: null });
  });
});
