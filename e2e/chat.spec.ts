import { test, expect } from '@playwright/test';
import { loadTestEnv, cleanupTestDb, waitForApiResponse, verifyTestDb, setupPageWithUser, waitForChatCompletion, clickNewChat } from './test-utils';

// Load test environment before tests
loadTestEnv();

// Run cleanup once per worker (not per test) - this only affects parallel workers at startup
// We use a flag to ensure only one worker cleans the DB
let cleanupDone = false;
test.beforeAll(async () => {
  if (!cleanupDone) {
    // cleanupTestDb(); // Disabled to prevent race conditions in parallel mode
    if (process.env.VERIFY_DB !== 'false') {
      verifyTestDb();
      process.env.VERIFY_DB = 'false';
    }
    cleanupDone = true;
  }
});

test.describe('Chat Application', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should load the home page @smoke', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check if the app loads
    await expect(page.locator('text=Brain').first()).toBeVisible({ timeout: 10000 });
    // Home page shows highlights section and action buttons
    await expect(page.locator('.highlights-section').first()).toBeVisible({ timeout: 10000 });
  });

  test('should create a new chat and send a message @smoke', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Type a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Hello, this is a test message');

    // Send the message - wait for response promise before clicking
    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    // Wait for the API call
    await responsePromise;

    // Check that user message appears
    await expect(page.locator('text=Hello, this is a test message')).toBeVisible({ timeout: 10000 });

    // Wait for assistant response (may take time)
    await page.waitForTimeout(5000);

    // Check that assistant response appears (at least some content)
    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 30000 });
  });

  test('should toggle sidebar collapse', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');

    // Find and click the sidebar toggle button
    const toggleButton = page.locator('button.sidebar-toggle');
    await expect(toggleButton).toBeVisible();

    // Get initial sidebar width
    const sidebar = page.locator('.sidebar');
    const initialWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);

    // Click to collapse
    await toggleButton.click();
    await page.waitForTimeout(300);

    // Check sidebar is collapsed
    const collapsedWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(collapsedWidth).toBeLessThan(initialWidth);

    // Click again to expand
    await toggleButton.click();
    await page.waitForTimeout(300);

    // Check sidebar is expanded
    const expandedWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(expandedWidth).toBeGreaterThan(collapsedWidth);
  });


  test('should display chat history after sending messages', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Test conversation');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    // Wait for response and title generation
    await responsePromise;
    await page.waitForTimeout(8000); // Wait for title generation

    // Check that conversation appears in sidebar
    const chatHistory = page.locator('.chat-history');
    await expect(chatHistory).toBeVisible({ timeout: 15000 });

    // Should have at least one conversation item
    const chatItems = page.locator('.chat-item');
    await expect(chatItems.first()).toBeVisible({ timeout: 15000 });
  });

  test('should delete conversation with confirmation', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // First create a conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Test delete');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Wait for stream to complete
    await waitForChatCompletion(page);

    // We're now on /chat/[id] — open the chat-menu-button in the header
    const chatItems = page.locator('.chat-item');
    const chatItemCount = await chatItems.count();

    // Open the triple-dot menu in the conversation header
    const menuButton = page.locator('.chat-menu-button');
    await menuButton.waitFor({ timeout: 10000 });
    await menuButton.click();

    // Click Delete in the dropdown
    await page.locator('.chat-menu-item-danger').click();

    // Check confirmation dialog appears
    await expect(page.locator('h3:text("Delete Conversation")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Are you sure')).toBeVisible();

    // Cancel deletion
    await page.locator('button.delete-btn-cancel').click();
    await page.waitForTimeout(500);

    // Re-open menu and delete again
    await menuButton.click();
    await page.locator('.chat-menu-item-danger').click();
    await expect(page.locator('text=Delete Conversation')).toBeVisible({ timeout: 5000 });

    // Wait for delete API call
    const deleteResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/conversations/') && response.request().method() === 'DELETE',
      { timeout: 10000 }
    );

    // Confirm deletion
    await page.locator('button.delete-btn-confirm').click();
    await deleteResponsePromise;

    // Should redirect to home after deletion
    await page.waitForURL(/\/$/, { timeout: 5000 });
    await expect(page.locator('text=Delete Conversation')).not.toBeVisible({ timeout: 2000 });

    // Check conversation is removed from sidebar
    const remainingItems = page.locator('.chat-item');
    await page.waitForTimeout(500);
    const remainingCount = await remainingItems.count();

    if (chatItemCount > 1) {
      expect(remainingCount).toBeLessThan(chatItemCount);
    } else {
      expect(remainingCount).toBe(0);
    }
  });

  test('should load existing conversation when clicked', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation first with a unique message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    const testMessage = `Load test message ${Date.now()}`;
    await input.fill(testMessage);

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Get the conversation URL (we're now on /chat/[id])
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });
    const conversationUrl = page.url();

    // Wait for title generation to complete
    await page.waitForTimeout(8000);

    // Wait for conversation to appear in sidebar
    const chatItems = page.locator('.chat-item');
    await expect(chatItems.first()).toBeVisible({ timeout: 15000 });

    // Wait for the title to be generated (not "New Chat")
    const firstChatTitle = chatItems.first().locator('.chat-item-title');
    await expect(firstChatTitle).not.toHaveText('New Chat', { timeout: 10000 });

    // Get the generated title to identify our conversation later
    const generatedTitle = await firstChatTitle.textContent();

    // Start new chat to clear current view (this does a hard reload now)
    await clickNewChat(page);

    // Wait for page to load after hard reload
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Verify we're on home page
    await expect(page).toHaveURL(/.*\/$/);

    // Re-query chat items after reload to avoid stale references
    const freshChatItems = page.locator('.chat-item');
    await expect(freshChatItems.first()).toBeVisible({ timeout: 15000 });

    // Find our specific conversation by title (in case there are multiple from previous tests)
    const ourChatItem = freshChatItems.filter({ hasText: generatedTitle || '' }).first();
    await expect(ourChatItem).toBeVisible({ timeout: 15000 });

    // Click our conversation item
    await ourChatItem.click();

    // Wait for URL to change back to our conversation
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });

    // Verify we loaded the correct conversation
    expect(page.url()).toBe(conversationUrl);

    // Wait for messages to render
    await page.waitForTimeout(2000);

    // Check that messages wrapper exists and has messages
    const messagesWrapper = page.locator('.messages-wrapper');
    await expect(messagesWrapper).toBeVisible({ timeout: 10000 });

    // Check that at least one user message exists
    const userMessages = messagesWrapper.locator('.message.user .message-text');
    await expect(userMessages.first()).toBeVisible({ timeout: 10000 });

    // Verify the first user message contains our test message
    const messageText = await userMessages.first().textContent();
    expect(messageText).toContain(testMessage);
  });

  test('should handle empty input gracefully', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });

    // Pressing Enter with empty input should not send a message
    await input.press('Enter');

    // Should still be on empty state (no messages)
    await expect(page.locator('.empty-state')).toBeVisible();

    // Type something and clear - input should still work
    await input.fill('test');
    await expect(input).toHaveValue('test');

    await input.fill('');
    await expect(input).toHaveValue('');
  });

  test('should support multiline input with Shift+Enter', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });

    // Type first line
    await input.fill('Line 1');

    // Press Shift+Enter to create a new line
    await input.press('Shift+Enter');

    // Type second line
    await input.type('Line 2');

    // Press Shift+Enter again
    await input.press('Shift+Enter');

    // Type third line
    await input.type('Line 3');

    // Verify the textarea contains multiple lines
    const value = await input.inputValue();
    expect(value).toBe('Line 1\nLine 2\nLine 3');

    // Verify textarea has expanded (height should be greater than initial 40px)
    const height = await input.evaluate((el) => (el as HTMLTextAreaElement).offsetHeight);
    expect(height).toBeGreaterThan(40);

    // Should still be on empty state (no message sent yet)
    await expect(page.locator('.empty-state')).toBeVisible();

    // Now press Enter (without Shift) to send the message
    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');

    // Wait for the API call
    await responsePromise;

    // Verify the multiline message appears in the chat
    await expect(page.locator('text=Line 1')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Line 2')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Line 3')).toBeVisible({ timeout: 10000 });
  });

  test('should display response mode dropdown', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that mode dropdown is visible
    const modeSelect = page.locator('#response-mode');
    await expect(modeSelect).toBeVisible({ timeout: 10000 });

    // Check that it has Quick and Detailed options
    const quickOption = modeSelect.locator('option[value="quick"]');
    const detailedOption = modeSelect.locator('option[value="detailed"]');
    await expect(quickOption).toHaveText('Quick');
    await expect(detailedOption).toHaveText('Detailed');

    // Default should be Detailed
    await expect(modeSelect).toHaveValue('detailed');
  });

  test('should switch between response modes', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const modeSelect = page.locator('#response-mode');
    await expect(modeSelect).toBeVisible({ timeout: 10000 });

    // Select Quick mode
    await modeSelect.selectOption('quick');
    await expect(modeSelect).toHaveValue('quick');

    // Select Detailed mode
    await modeSelect.selectOption('detailed');
    await expect(modeSelect).toHaveValue('detailed');
  });

  test('should persist response mode to server', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const modeSelect = page.locator('#response-mode');
    await expect(modeSelect).toBeVisible({ timeout: 10000 });

    // Select Quick mode
    await modeSelect.selectOption('quick');

    // Wait for preference to be saved to server
    await page.waitForTimeout(500);

    // Verify by fetching from preferences API
    const savedMode = await page.evaluate(async () => {
      const res = await fetch('/api/preferences?key=chat:responseMode');
      const data = await res.json();
      return data.value;
    });
    expect(savedMode).toBe('quick');

    // Change to Detailed mode
    await modeSelect.selectOption('detailed');

    // Wait for preference to be saved
    await page.waitForTimeout(500);

    // Verify updated
    const updatedMode = await page.evaluate(async () => {
      const res = await fetch('/api/preferences?key=chat:responseMode');
      const data = await res.json();
      return data.value;
    });
    expect(updatedMode).toBe('detailed');
  });

  test('should load saved response mode from server on page load', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Set mode to quick
    const modeSelect = page.locator('#response-mode');
    await modeSelect.selectOption('quick');

    // Wait for preference to be saved
    await page.waitForTimeout(500);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check that mode is loaded from server
    await expect(modeSelect).toBeVisible({ timeout: 10000 });
    await expect(modeSelect).toHaveValue('quick');
  });

  test('should send message with selected response mode', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Quick mode
    const modeSelect = page.locator('#response-mode');
    await modeSelect.selectOption('quick');

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('What is JavaScript?');

    // Intercept the API call to verify mode is sent
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/api/chat') && request.method() === 'POST'
    );

    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    const request = await requestPromise;
    const requestBody = request.postDataJSON();

    // Verify mode is included in the request
    expect(requestBody.mode).toBe('quick');

    // Wait for response
    await page.waitForTimeout(5000);
  });

  test('should preserve mode selection when switching conversations', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Quick mode
    const modeSelect = page.locator('#response-mode');
    await modeSelect.selectOption('quick');

    // Send a message to create a conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('First conversation');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;
    await page.waitForTimeout(5000);

    // Start new chat
    await clickNewChat(page);
    await page.waitForTimeout(500);

    // Mode should still be Quick (loaded from localStorage)
    await expect(modeSelect).toHaveValue('quick');
  });

  test('should disable mode dropdown while loading', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const modeSelect = page.locator('#response-mode');
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Test message');

    // Start sending - dropdown should become disabled
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    // Check dropdown is disabled during loading
    await expect(modeSelect).toBeDisabled({ timeout: 2000 });

    // Wait for completion
    await page.waitForTimeout(10000);

    // Dropdown should be enabled again after loading completes
    await expect(modeSelect).toBeEnabled({ timeout: 15000 });
  });

  test('should allow changing provider without immediate revert', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Send first message with Gemini
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Hello Gemini');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;

    // Wait for URL to update to /chat/[id]
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });

    // 2. Reload the page to ensure we are in a "loaded from DB" state
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 3. Verify initial provider is Gemini
    const providerSelect = page.locator('#ai-provider');
    await expect(providerSelect).toHaveValue('gemini');

    // 4. Change provider to Grok (xai)
    await providerSelect.selectOption('xai');

    // 5. Wait to ensure it doesn't revert. 
    await page.waitForTimeout(1000);

    // 6. Assert it is still xai
    await expect(providerSelect).toHaveValue('xai', { timeout: 1000 });
  });

  test('should preserve conversation after cancelling second message', async ({ page }) => {
    // Regression: cancelling a message on an established conversation
    // should not reset the conversation (isNewConversationRef bug)
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Send first message and let it complete
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Hello, remember this message');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;

    // Wait for the chat to fully complete
    await waitForChatCompletion(page);

    // Should be on /chat/[id] now
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });
    const chatUrl = page.url();

    // 2. Send a second message and cancel it
    await input.fill('Second message to cancel');
    const responsePromise2 = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise2;

    // Wait for stop button and cancel
    const stopBtn = page.locator('.stop-btn');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await stopBtn.click();

    // Wait for cancellation to complete
    await expect(input).toBeEnabled({ timeout: 10000 });

    // 3. URL should stay on the same conversation (not reset to home)
    expect(page.url()).toBe(chatUrl);

    // 4. The first message should still be visible
    await expect(page.locator('text=Hello, remember this message')).toBeVisible({ timeout: 5000 });

    // 5. Send another message - it should work within the same conversation
    await input.fill('Third message after cancel');
    const responsePromise3 = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise3;

    // Should get a response and stay on the same URL
    await expect(page.locator('.message.assistant').last()).toBeVisible({ timeout: 30000 });
    expect(page.url()).toBe(chatUrl);
  });

  test('should allow sending message after cancelling first message', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('First message to cancel');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;

    // Wait for the stop button to appear (streaming has started)
    const stopBtn = page.locator('.stop-btn');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Cancel the stream
    await stopBtn.click();

    // Wait for cancellation to complete - input should be re-enabled
    await expect(input).toBeEnabled({ timeout: 10000 });

    // Input should be empty (message was already sent, partial progress preserved)
    await expect(input).toHaveValue('');

    // Conversation is preserved — URL stays on the chat
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });

    // Now send a follow-up message
    await input.fill('Follow up question');
    const responsePromise2 = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise2;

    // Should get an assistant response
    await expect(page.locator('.message.assistant').last()).toBeVisible({ timeout: 30000 });
  });

  test('should rename a conversation via the chat menu', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message to create a conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Rename test conversation');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Wait for the chat to fully complete
    await waitForChatCompletion(page);

    // Should be on /chat/[id] — open the chat-menu-button in the header
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });
    const menuButton = page.locator('.chat-menu-button');
    await menuButton.waitFor({ timeout: 10000 });
    await menuButton.click();

    // Click Rename in the dropdown
    const renameOption = page.locator('.chat-menu-item').filter({ hasText: 'Rename' });
    await renameOption.waitFor({ timeout: 3000 });
    await renameOption.click();

    // Rename dialog should appear
    await expect(page.locator('h3:text("Rename Conversation")')).toBeVisible({ timeout: 5000 });

    // Clear and type a new name
    const renameInput = page.locator('.rename-input');
    await renameInput.waitFor({ timeout: 3000 });
    await renameInput.fill('My Renamed Conversation');

    // Wait for the rename API call
    const renameResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/conversations/') && response.request().method() === 'PATCH',
      { timeout: 10000 }
    );

    await page.locator('button.rename-btn-confirm').click();
    await renameResponsePromise;

    // Dialog should close
    await expect(page.locator('h3:text("Rename Conversation")')).not.toBeVisible({ timeout: 3000 });

    // The chat header title and sidebar should both show the new name
    await expect(page.locator('.chat-title')).toHaveText('My Renamed Conversation', { timeout: 5000 });
    await expect(page.locator('.chat-item-title').filter({ hasText: 'My Renamed Conversation' })).toBeVisible({ timeout: 5000 });
  });

  test('should save and display thumbs up/down feedback', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Message for feedback test');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;

    // Wait for the chat to fully complete
    await waitForChatCompletion(page);

    // Get the assistant message
    const assistantMessage = page.locator('.message.assistant').first();
    await assistantMessage.waitFor({ timeout: 15000 });

    // Look for feedback buttons
    const thumbsUpBtn = assistantMessage.locator('button[title="Good response"]');
    const thumbsDownBtn = assistantMessage.locator('button[title="Bad response"]');

    await thumbsUpBtn.waitFor({ timeout: 5000 });
    await thumbsDownBtn.waitFor({ timeout: 5000 });

    // Click thumbs up
    const feedbackResponsePromise1 = waitForApiResponse(page, /\/api\/conversations\/[a-f0-9-]+\/events\/[^\\/]+\/feedback/, 10000);
    await thumbsUpBtn.click();
    await feedbackResponsePromise1;

    // Verify it's active
    await expect(thumbsUpBtn).toHaveClass(/active/);
    await expect(thumbsDownBtn).not.toHaveClass(/active/);

    // Reload and check persistence
    await page.reload();
    await page.waitForLoadState('networkidle');

    const reloadedAssistantMsg = page.locator('.message.assistant').first();
    await reloadedAssistantMsg.waitFor({ timeout: 15000 });

    let activeThumbsUpBtn = reloadedAssistantMsg.locator('button[title="Good response"]');
    await activeThumbsUpBtn.waitFor({ timeout: 5000 });
    await expect(activeThumbsUpBtn).toHaveClass(/active/);

    // Click thumbs down
    const feedbackResponsePromise2 = waitForApiResponse(page, /\/api\/conversations\/[a-f0-9-]+\/events\/[^\\/]+\/feedback/, 10000);
    const reloadedThumbsDownBtn = reloadedAssistantMsg.locator('button[title="Bad response"]');
    await reloadedThumbsDownBtn.click();
    await feedbackResponsePromise2;

    // Verify it changed
    await expect(activeThumbsUpBtn).not.toHaveClass(/active/);
    await expect(reloadedThumbsDownBtn).toHaveClass(/active/);

    // Click again to unset
    const feedbackResponsePromise3 = waitForApiResponse(page, /\/api\/conversations\/[a-f0-9-]+\/events\/[^\\/]+\/feedback/, 10000);
    await reloadedThumbsDownBtn.click();
    await feedbackResponsePromise3;

    // Verify both are inactive
    await expect(activeThumbsUpBtn).not.toHaveClass(/active/);
    await expect(reloadedThumbsDownBtn).not.toHaveClass(/active/);
  });
});

test.describe('Chat Page URLs', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // Don't use shared storageState - each test will create its own user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should update URL to /chat/[id] after sending first message', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify we're on the home page
    await expect(page).toHaveURL(/.*\/$/);

    // Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Test URL update');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Wait for streaming to complete and URL to update
    await page.waitForTimeout(8000);

    // URL should now be /chat/[id]
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/chat\/[a-f0-9-]+$/);
  });

  test('should preserve chat content after page reload', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message with unique content
    const uniqueMessage = `Reload test ${Date.now()}`;
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill(uniqueMessage);

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Wait for streaming to complete and URL to update
    // Wait for streaming to complete and URL to update
    await waitForChatCompletion(page);

    // Get the conversation URL - it should now be /chat/[id]
    const chatUrl = page.url();
    expect(chatUrl).toMatch(/\/chat\/[a-f0-9-]+$/);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for messages container to appear
    const messagesWrapper = page.locator('.messages-wrapper');
    await expect(messagesWrapper).toBeVisible({ timeout: 15000 });

    // Wait a bit more for content to render
    await page.waitForTimeout(2000);

    // Verify the user message is still there
    const userMessage = page.locator('.message.user');
    await expect(userMessage.first()).toBeVisible({ timeout: 10000 });

    // Check that the message content contains our unique message
    const messageContent = await userMessage.first().textContent();
    expect(messageContent).toContain(uniqueMessage);

    // Verify we're still on the same URL
    expect(page.url()).toBe(chatUrl);
  });

  test('should load conversation when navigating directly to /chat/[id]', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    // First create a conversation
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const uniqueMessage = `Direct nav test ${Date.now()}`;
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill(uniqueMessage);

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Wait for streaming to complete and URL to update
    // Wait for streaming to complete and URL to update
    await waitForChatCompletion(page);

    // Get the chat URL - should now be /chat/[id]
    const chatUrl = page.url();
    expect(chatUrl).toMatch(/\/chat\/[a-f0-9-]+$/);

    // Navigate away first - go to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Now navigate directly to the chat URL
    await page.goto(chatUrl);
    await page.waitForLoadState('networkidle');

    // Wait for conversation to load
    await page.waitForTimeout(3000);

    // Verify the message is loaded - use specific selector to avoid matching AI response
    await expect(page.locator('.message.user .message-text')).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to chat page when clicking sidebar item', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Sidebar navigation test');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    await waitForChatCompletion(page);

    // Click new chat to go back to home
    await clickNewChat(page);

    // Wait for navigation to home page
    await page.waitForURL(/\/$/, { timeout: 10000 });

    // Click on the conversation in sidebar
    const chatItem = page.locator('.chat-item').first();
    await expect(chatItem).toBeVisible({ timeout: 10000 });
    await chatItem.click();

    // Wait for navigation
    await page.waitForTimeout(1000);

    // Verify URL changed to chat page
    expect(page.url()).toMatch(/\/chat\/[a-f0-9-]+$/);

    // Verify messages are loaded - use specific selector to avoid matching sidebar and other elements
    await expect(page.locator('.message.user .message-text')).toBeVisible({ timeout: 10000 });
  });

  test('should not flash loading screen on fast navigation', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    // First create a conversation
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Flash test message');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    await waitForChatCompletion(page);

    // Go to home
    await clickNewChat(page);
    await page.waitForTimeout(500);

    // Navigate to chat page
    const chatItem = page.locator('.chat-item').first();
    await chatItem.click();

    // Wait for navigation
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 10000 });

    // Content should appear - the key is that loading indicator should NOT flash
    // We verify this by checking that content appears quickly
    await expect(page.locator('text=Flash test message').first()).toBeVisible({ timeout: 5000 });

    // Verify no "Loading..." text is visible (should have been skipped due to fast load)
    const loadingText = page.locator('h2:text("Loading...")');
    await expect(loadingText).not.toBeVisible();
  });

  test('should keep sidebar stable during navigation', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create two conversations
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('First conversation');

    let responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Check for summarize button
    await waitForChatCompletion(page);

    // Create second conversation
    await clickNewChat(page);
    await page.waitForTimeout(500);

    await input.fill('Second conversation');
    responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;
    await expect(page.locator('.summarize-button')).toBeVisible({ timeout: 60000 });

    // Get sidebar state before navigation
    const sidebarBefore = await page.locator('.sidebar').boundingBox();
    const chatItemCount = await page.locator('.chat-item').count();

    // Navigate between conversations
    const firstChatItem = page.locator('.chat-item').first();
    await firstChatItem.click();
    await page.waitForTimeout(500);

    // Check sidebar is still the same size (no flash/re-render)
    const sidebarAfter = await page.locator('.sidebar').boundingBox();
    expect(sidebarAfter?.width).toBe(sidebarBefore?.width);

    // Check conversation count is preserved
    const chatItemCountAfter = await page.locator('.chat-item').count();
    expect(chatItemCountAfter).toBe(chatItemCount);
  });

  test('should highlight active conversation in sidebar', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Active highlight test');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');
    await responsePromise;

    // Wait for URL to change to /chat/[id]
    await page.waitForURL(/\/chat\/[a-f0-9-]+$/, { timeout: 15000 });

    // Wait for streaming to complete
    await waitForChatCompletion(page);

    // Check that the conversation is highlighted as active
    const activeItem = page.locator('.chat-item.active');
    await expect(activeItem).toBeVisible({ timeout: 10000 });

    // Go to home
    await clickNewChat(page);
    await page.waitForTimeout(500);

    // On home page, no conversation should be active
    // (we're on "/" not "/chat/[id]")
    const activeItemsOnHome = await page.locator('.chat-item.active').count();
    expect(activeItemsOnHome).toBe(0);

    // Click on the conversation
    const chatItem = page.locator('.chat-item').first();
    await chatItem.click();
    await page.waitForTimeout(500);

    // Should be active again
    await expect(page.locator('.chat-item.active')).toBeVisible({ timeout: 5000 });
  });

  test('should redirect to home if conversation not found', async ({ page }) => {
    // Setup unique user for this test
    await setupPageWithUser(page);

    // Try to navigate to a non-existent conversation
    await page.goto('/chat/non-existent-id-12345');

    // Should redirect to home
    await page.waitForURL(/\/$/, { timeout: 10000 });

    // Should show the home page with highlights section
    await expect(page.locator('.highlights-section').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Chat File Upload', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show drop overlay when dragging over input area', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Default model is Gemini which supports file upload
    const inputContainer = page.locator('.input-container');
    await expect(inputContainer).toBeVisible({ timeout: 10000 });

    // Simulate dragenter
    await inputContainer.evaluate((el) => {
      el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
    });

    // Should show the drag-over overlay
    await expect(inputContainer).toHaveClass(/drag-over/);

    // Simulate dragleave
    await inputContainer.evaluate((el) => {
      el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    });

    // Should hide the drag-over overlay
    await expect(inputContainer).not.toHaveClass(/drag-over/);
  });

  test('should not show drop overlay for models without file upload', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to xai which doesn't support file upload
    const providerSelect = page.locator('#ai-provider');
    await providerSelect.selectOption('xai');
    await page.waitForTimeout(300);

    const inputContainer = page.locator('.input-container');

    // Simulate dragenter
    await inputContainer.evaluate((el) => {
      el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
    });

    // Should NOT show drag-over overlay
    await expect(inputContainer).not.toHaveClass(/drag-over/);
  });

  test('should upload file when dropped on input area', async ({ page }) => {
    await setupPageWithUser(page);

    // Mock the upload API
    let uploadCalled = false;
    await page.route('**/api/ai/upload', async (route) => {
      uploadCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          file: {
            uri: 'test://uploaded-file',
            name: 'projects/test/files/test',
            mimeType: 'image/png',
            sizeBytes: 1024,
            fileName: 'test.png',
            uploadedAt: new Date().toISOString(),
            expirationTime: new Date(Date.now() + 86400000).toISOString(),
          }
        })
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const inputContainer = page.locator('.input-container');
    await expect(inputContainer).toBeVisible({ timeout: 10000 });

    // Drop a file on the input area
    await inputContainer.evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['test-image'], 'photo.png', { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });

    // Should show the file attachment preview
    await expect(page.locator('.file-attachment-item')).toBeVisible({ timeout: 5000 });
    expect(uploadCalled).toBe(true);
  });

  test('should upload image when pasted into chat input', async ({ page }) => {
    await setupPageWithUser(page);

    // Mock the upload API
    let uploadCalled = false;
    await page.route('**/api/ai/upload', async (route) => {
      uploadCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          file: {
            uri: 'test://pasted-file',
            name: 'projects/test/files/pasted',
            mimeType: 'image/png',
            sizeBytes: 512,
            fileName: 'clipboard.png',
            uploadedAt: new Date().toISOString(),
            expirationTime: new Date(Date.now() + 86400000).toISOString(),
          }
        })
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('textarea[placeholder="Ask me anything..."]');
    await textarea.focus();

    // Dispatch paste event with an image file
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['test-image'], 'clipboard.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      document.querySelector('textarea')?.dispatchEvent(event);
    });

    // Should show the file attachment preview
    await expect(page.locator('.file-attachment-item')).toBeVisible({ timeout: 5000 });
    expect(uploadCalled).toBe(true);
  });
});

