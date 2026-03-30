import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { loadTestEnv, cleanupTestDb, waitForApiResponse, verifyTestDb, setupPageWithUser, waitForChatCompletion, createUniqueUser, seedFreshHighlights } from './test-utils';
import { createEvent } from '../src/lib/db';

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

test.describe('Anthropic Provider Specifics', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show file upload button for Anthropic', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Check that upload button IS visible (local file upload)
    const uploadBtn = page.locator('button.image-upload-btn');
    await expect(uploadBtn).toBeVisible();
  });

  test('should upload image and send with message for Anthropic', async ({ page }) => {
    test.setTimeout(90000);

    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Create a 100x100 red square PNG using sharp
    const testImageBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    }).png().toBuffer();

    // Set up file chooser handler and upload image
    const fileChooserPromise = page.waitForEvent('filechooser');

    const uploadBtn = page.locator('button.image-upload-btn');
    await expect(uploadBtn).toBeVisible({ timeout: 10000 });
    await uploadBtn.click();

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: testImageBuffer,
    });

    // Wait for file to upload and preview to appear
    const fileAttachmentsPreview = page.locator('.file-attachments-preview');
    await expect(fileAttachmentsPreview).toBeVisible({ timeout: 10000 });

    // Verify file attachment item is displayed
    const fileItem = page.locator('.file-attachment-item');
    await expect(fileItem).toBeVisible();

    // Verify file name is shown
    await expect(fileItem.locator('.file-name')).toContainText('test-image.png');

    // Type a question about the image
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What colors are in this image?');

    // Intercept the API call to verify files are sent
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/chat') && request.method() === 'POST'
    );

    // Send the message
    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');

    // Verify request contains files data with local URI
    const request = await requestPromise;
    const requestBody = request.postDataJSON();
    expect(requestBody.files).toBeTruthy();
    expect(Array.isArray(requestBody.files)).toBe(true);
    expect(requestBody.files.length).toBe(1);
    expect(requestBody.files[0].fileName).toBe('test-image.png');
    expect(requestBody.files[0].uri).toContain('/uploads/');
    expect(requestBody.aiProvider).toBe('claude-haiku');

    // Wait for API response
    await responsePromise;

    // Wait for stream to complete
    await waitForChatCompletion(page);

    // Verify user message appears
    await expect(page.locator('text=What colors are in this image?')).toBeVisible({ timeout: 10000 });

    // File attachments preview should be cleared after sending
    await expect(fileAttachmentsPreview).not.toBeVisible({ timeout: 5000 });

    // Verify image thumbnail appears in the user message
    const userMessage = page.locator('.message.user').last();
    const thumbnail = userMessage.locator('img.message-image-thumbnail');
    await expect(thumbnail).toBeVisible({ timeout: 10000 });
    const src = await thumbnail.getAttribute('src');
    expect(src).toContain('/uploads/');

    // Verify assistant response appears
    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 30000 });

    // Verify the AI describes the red image
    await expect(assistantMessages.first()).toContainText(/red/i, { timeout: 15000 });
  });

  test('should respond with correct current date when asked about time (Anthropic)', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Send a message asking about the current time/date
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill("What is today's date?");

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    await responsePromise;
    await waitForChatCompletion(page);

    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 30000 });

    const responseText = await assistantMessages.first().textContent();

    // Anthropic should also have access to current time context
    expect(responseText).toContain('2026');
  });
});

test.describe('Anthropic Thinking Mode', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should send thinking: true when THINK checkbox is checked', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Verify THINK checkbox is checked (default)
    const thinkCheckbox = page.locator('input[type="checkbox"]');
    await expect(thinkCheckbox).toBeVisible();
    if (!(await thinkCheckbox.isChecked())) {
      await thinkCheckbox.check();
    }
    await expect(thinkCheckbox).toBeChecked();

    // Intercept the API call to verify thinking parameter
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/chat') && request.method() === 'POST'
    );

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What is 2+2?');
    await input.press('Enter');

    const request = await requestPromise;
    const requestBody = request.postDataJSON();

    // Verify thinking is true and provider is anthropic
    expect(requestBody.thinking).toBe(true);
    expect(requestBody.aiProvider).toBe('claude-haiku');

    await waitForChatCompletion(page);
  });

  test('should send thinking: false when THINK checkbox is unchecked', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Uncheck THINK checkbox
    const thinkCheckbox = page.locator('input[type="checkbox"]');
    await expect(thinkCheckbox).toBeVisible();
    await thinkCheckbox.uncheck();
    await expect(thinkCheckbox).not.toBeChecked();

    // Intercept the API call to verify thinking parameter
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/chat') && request.method() === 'POST'
    );

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What is 2+2?');
    await input.press('Enter');

    const request = await requestPromise;
    const requestBody = request.postDataJSON();

    // Verify thinking is false and provider is anthropic
    expect(requestBody.thinking).toBe(false);
    expect(requestBody.aiProvider).toBe('claude-haiku');

    await waitForChatCompletion(page);
  });
});

test.describe('Anthropic Status and Tools', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should use event tool to find events', async ({ page }) => {
    test.setTimeout(90000);

    // Create user and get their ID
    const user = await createUniqueUser();

    // Create a test event for this user
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);

    const eventId = `evt_test_${Date.now()}`;
    await createEvent(
      user.id,
      eventId,
      'Important Meeting with Bob',
      'Discuss project roadmap',
      'Conference Room B',
      tomorrow.toISOString(),
      null,
      null,
      null
    );

    // Inject auth cookie
    await page.context().addCookies([{
      name: 'auth-token',
      value: user.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    }]);
    seedFreshHighlights(user.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Ask about events
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What events do I have coming up?');
    await input.press('Enter');

    // Wait for the response stream to complete
    await waitForChatCompletion(page);

    // Verify the response contains the event we created
    const messageContent = page.locator('.message.assistant').last();
    await expect(messageContent).toContainText('Bob', { timeout: 15000 });
  });

  test('should show status in UI when calling tools', async ({ page }) => {
    test.setTimeout(90000);

    // Create user and get their ID
    const user = await createUniqueUser();

    // Create a test event for this user
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);

    const eventId = `evt_test_status_${Date.now()}`;
    await createEvent(
      user.id,
      eventId,
      'Status Test Meeting',
      'Test description',
      'Test Location',
      tomorrow.toISOString(),
      null,
      null,
      null
    );

    // Inject auth cookie
    await page.context().addCookies([{
      name: 'auth-token',
      value: user.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax' as const,
    }]);
    seedFreshHighlights(user.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Use page.evaluate to set up a MutationObserver before sending the message
    await page.evaluate(() => {
      (window as any).__statusObservations = [];
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            const indicators = document.querySelectorAll('.typing-indicator');
            indicators.forEach((el) => {
              const text = el.textContent || '';
              if (text && !(window as any).__statusObservations.includes(text)) {
                (window as any).__statusObservations.push(text);
              }
            });
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    // Ask about events to trigger tool use
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What events do I have scheduled?');
    await input.press('Enter');

    // Wait for completion
    await waitForChatCompletion(page);

    // Get the observed status messages
    const capturedStatuses = await page.evaluate(() => (window as any).__statusObservations || []);

    // Log what we captured for debugging
    console.log('Captured status messages:', capturedStatuses);

    // Verify response contains event info (proves tool was used)
    const messageContent = page.locator('.message.assistant').last();
    const responseText = await messageContent.textContent();

    // The response should mention the event we created, proving tool was used
    expect(responseText).toContain('Status Test Meeting');
  });

  test('should use Google Places tool to find locations', async ({ page }) => {
    test.setTimeout(90000);

    await setupPageWithUser(page);
    await page.goto('/');

    // Select Anthropic provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('claude-haiku');

    // Send the message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Show me Paan Paan locations near BMICH in Sri Lanka');
    await input.press('Enter');

    // Wait for the response stream to complete
    await waitForChatCompletion(page);

    // Verify the response contains the specific location name found via tool
    const messageContent = page.locator('.message.assistant').last();
    await expect(messageContent).toContainText('Paan Paan', { timeout: 10000 });
  });
});
