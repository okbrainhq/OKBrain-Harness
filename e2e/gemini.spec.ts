import { test, expect } from '@playwright/test';
import { loadTestEnv, waitForApiResponse, verifyTestDb, setupPageWithUser, waitForChatCompletion } from './test-utils';

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

test.describe('Gemini Provider Specifics', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should respond with correct current date when asked about time', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Ensure Gemini is selected (default, but good to be explicit)
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('gemini');

    // Send a message asking about the current time/date
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill("What is today's date?");

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    // Wait for the API call
    await responsePromise;

    // Wait for stream to complete
    // Wait for stream to complete
    await waitForChatCompletion(page);

    // Wait for assistant response
    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 30000 });

    // Get the response text
    const responseText = await assistantMessages.first().textContent();

    // Verify the response contains the current year (2026)
    // The model should have access to current time context
    expect(responseText).toContain('2026');

    // Response should NOT contain the old training data date (2024)
    expect(responseText).not.toContain('2024');
  });
});

test.describe('Gemini File Upload', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should upload image, ask question about it, and show attachment in message', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Ensure Gemini is selected (default, but good to be explicit)
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('gemini');

    // Create a test image (1x1 red pixel PNG)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const testImageBuffer = Buffer.from(testImageBase64, 'base64');

    // Set up file chooser handler and upload image
    const fileChooserPromise = page.waitForEvent('filechooser');

    // Click the file attachment button (📎 paperclip)
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

    // Verify preview image is displayed (since it's an image file)
    const previewImg = fileItem.locator('img');
    await expect(previewImg).toBeVisible();

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

    // Verify request contains files data
    const request = await requestPromise;
    const requestBody = request.postDataJSON();
    expect(requestBody.files).toBeTruthy();
    expect(Array.isArray(requestBody.files)).toBe(true);
    expect(requestBody.files.length).toBe(1);
    expect(requestBody.files[0].fileName).toBe('test-image.png');
    expect(requestBody.files[0].mimeType).toBe('image/png');
    expect(requestBody.message).toBe('What colors are in this image?');

    // Wait for API response
    await responsePromise;

    // Wait for stream to complete
    // Wait for stream to complete
    await waitForChatCompletion(page);

    // Verify user message appears
    await expect(page.locator('text=What colors are in this image?')).toBeVisible({ timeout: 10000 });

    // File attachments preview should be cleared after sending
    await expect(fileAttachmentsPreview).not.toBeVisible({ timeout: 5000 });

    // Verify Gemini file upload shows "1 file attached" banner (not a broken image)
    const userMessage = page.locator('.message.user').last();
    await expect(userMessage.locator('text=1 file attached')).toBeVisible({ timeout: 5000 });
    // Should NOT have an image thumbnail (Gemini uses remote File API URIs)
    await expect(userMessage.locator('.message-image-thumbnail')).toHaveCount(0);

    // Verify assistant response appears
    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 30000 });

    // Verify the message content is not empty
    const assistantContent = await assistantMessages.first().textContent();
    expect(assistantContent).toBeTruthy();
    expect(assistantContent!.length).toBeGreaterThan(0);
  });
});

test.describe('Gemini Status and Thinking', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show thinking indicator and allow expanding thoughts when THINK is enabled', async ({ page }) => {
    test.setTimeout(150000);

    // Use real Gemini responses with harder prompts that usually trigger thinking output.
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Gemini Pro to maximize chance of receiving thought chunks.
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('gemini-pro');

    // Ensure THINK checkbox is checked
    const thinkCheckbox = page.locator('input[type="checkbox"]');
    await expect(thinkCheckbox).toBeVisible();
    if (!(await thinkCheckbox.isChecked())) {
      await thinkCheckbox.check();
    }
    await expect(thinkCheckbox).toBeChecked();

    const prompts = [
      'Is Google went bankrupt recently? Think carefully before answering.',
      'Has Alphabet (Google) filed for bankruptcy recently? Reason step by step, then answer briefly.',
      'Is Google bankrupt as of today? Think through recent business context before answering yes or no.',
      'Evaluate this claim carefully: "Google is bankrupt in 2026." First reason privately, then provide only your final verdict.',
      'Do a careful factual consistency check: has Alphabet entered bankruptcy proceedings recently? Be precise and concise.',
    ];

    let thoughtIndicatorFound = false;
    const input = page.locator('textarea[placeholder="Ask me anything..."]');

    for (let attempt = 0; attempt < prompts.length; attempt++) {
      await input.fill(prompts[attempt]);

      const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
      await input.press('Enter');

      const assistantMessage = page.locator('.message.assistant').last();
      await expect(assistantMessage).toBeVisible({ timeout: 30000 });

      await responsePromise;
      await expect(page.locator('.message.assistant.streaming')).toHaveCount(0, { timeout: 90000 });

      // Thoughts are rendered as sibling events, not inside .message.assistant
      const thoughtIndicator = page.locator('.thoughts-container > div').first();
      const hasThoughtIndicator = await thoughtIndicator.isVisible().catch(() => false);

      if (hasThoughtIndicator) {
        thoughtIndicatorFound = true;
        break;
      }
    }

    expect(thoughtIndicatorFound).toBe(true);
    const thoughtIndicator = page.locator('.thoughts-container > div').first();
    await expect(thoughtIndicator).toBeVisible({ timeout: 5000 });
    await expect(thoughtIndicator).toContainText('Thought');

    // Click the thought indicator to expand thoughts
    await thoughtIndicator.click();

    // Verify thoughts container is visible
    const thoughtsContainer = page.locator('.thoughts-container .content-styles').first();
    await expect(thoughtsContainer).toBeVisible();

    // Verify we have some content in thoughts
    const content = await thoughtsContainer.textContent();
    expect(content?.length).toBeGreaterThan(0);

    // Click to toggle (should collapse)
    await thoughtIndicator.click();

    // Wait a bit for the collapse animation
    await page.waitForTimeout(300);

    // Click again to expand
    await thoughtIndicator.click();
    await expect(thoughtsContainer).toBeVisible();
  });

  test('should use Google Places tool to find locations', async ({ page }) => {
    // Increase timeout since real AI calls can be slow
    test.setTimeout(90000);

    await setupPageWithUser(page);
    await page.goto('/');

    // Ensure Gemini is selected
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('gemini');

    // Send a message that requires finding places
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

test.describe("SSR Resume", () => {
    // Don't use shared storageState - each test will create its own user
    test.use({ storageState: { cookies: [], origins: [] } });

    test("should preserve streaming content when page is reloaded mid-stream", async ({
        page,
    }) => {
        // Increase timeout for this test - using thinking + tool calls takes longer
        test.setTimeout(180000);

        await setupPageWithUser(page);
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Use flash model - faster and cheaper while still triggering tool calls
        const aiProvider = page.locator("#ai-provider");
        await aiProvider.selectOption("gemini");

        // Enable THINK checkbox for longer processing time
        const thinkCheckbox = page.locator('input[type="checkbox"]');
        await expect(thinkCheckbox).toBeVisible();
        if (!(await thinkCheckbox.isChecked())) {
            await thinkCheckbox.check();
        }
        await expect(thinkCheckbox).toBeChecked();

        // Ask about weather - triggers tool call which takes more time
        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(
            "What is the current weather in Colombo, Sri Lanka? Please think about this carefully and provide a detailed response with the temperature, conditions, and any weather advisories.",
        );

        // Start the request
        await input.press("Enter");

        // Wait for the assistant message container to appear with streaming class
        const streamingMessage = page.locator(".message.assistant.streaming");
        await expect(streamingMessage).toBeVisible({ timeout: 30000 });

        // Wait for some indication that processing is happening
        // Either typing indicator or actual content
        await page.waitForFunction(
            () => {
                const typingIndicator = document.querySelector(
                    ".message.assistant.streaming .typing-indicator",
                );
                const msgText = document.querySelector(
                    ".message.assistant.streaming .message-text",
                );
                const content = msgText?.textContent || "";
                // Has typing indicator or has some content
                return typingIndicator !== null || content.length > 10;
            },
            { timeout: 60000 },
        );

        // Small delay to ensure processing is underway
        await page.waitForTimeout(1500);

        // Check if we have a typing indicator showing before reload
        const typingIndicatorBefore = page.locator(
            ".message.assistant.streaming .typing-indicator",
        );
        const hasIndicatorBefore = await typingIndicatorBefore
            .isVisible()
            .catch(() => false);
        if (hasIndicatorBefore) {
            const indicatorTextBefore =
                await typingIndicatorBefore.textContent();
            console.log("Typing indicator before reload:", indicatorTextBefore);
        }

        // Capture the current content before reload (may be empty if still thinking)
        const messageText = page.locator(".message.assistant .message-text");
        const contentBeforeReload = await messageText.textContent();
        console.log(
            "Content before reload length:",
            contentBeforeReload?.length,
        );

        // Get the current URL (should be the conversation URL)
        const currentUrl = page.url();
        console.log("Current URL:", currentUrl);

        // Make sure we're on a conversation URL (not just /)
        expect(currentUrl).toContain("/chat/");

        // Reload the page mid-stream
        await page.reload();
        await page.waitForLoadState("networkidle");

        // Wait for the assistant message to reappear
        const reloadedMessage = page.locator(".message.assistant").last();
        await expect(reloadedMessage).toBeVisible({ timeout: 10000 });

        // Check for typing indicator after reload
        const typingIndicator = page.locator(
            ".message.assistant .typing-indicator",
        );
        const isStillStreaming = await typingIndicator
            .isVisible()
            .catch(() => false);

        if (isStillStreaming) {
            const indicatorText = await typingIndicator.textContent();
            console.log(
                "Typing indicator visible after reload with text:",
                indicatorText,
            );
            // Verify it shows some status text (could be "Talking to Gemini" or a tool status)
            expect(indicatorText?.length).toBeGreaterThan(5);
        } else {
            console.log(
                "Streaming already completed before we could check the indicator after reload",
            );
        }

        // Get content after reload
        const reloadedMessageText = page
            .locator(".message.assistant .message-text")
            .last();
        const contentAfterReload = await reloadedMessageText.textContent();
        console.log("Content after reload length:", contentAfterReload?.length);

        // Wait for streaming to complete
        await waitForChatCompletion(page);

        // Final content should be complete and contain weather info
        const finalContent = await reloadedMessageText.textContent();
        console.log("Final content length:", finalContent?.length);

        // Final content should have meaningful length (a proper response)
        expect(finalContent?.length).toBeGreaterThan(50);

        // Should contain weather-related terms
        const hasWeatherContent =
            finalContent?.toLowerCase().includes("weather") ||
            finalContent?.toLowerCase().includes("temperature") ||
            finalContent?.toLowerCase().includes("colombo");
        expect(hasWeatherContent).toBe(true);
    });
});
