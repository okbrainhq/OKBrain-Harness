import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForApiResponse, waitForChatCompletion } from './test-utils';

loadTestEnv();

test.describe('Stop Functionality', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should stop FIRST message generation and preserve partial progress', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Type a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    const messageText = 'Write a 1000 word story about a robot who wants to learn how to cook.';
    await input.fill(messageText);

    // Send the message
    await input.press('Enter');

    // Verify stop button appears
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible({ timeout: 10000 });

    // Wait a bit to let generation start
    await page.waitForTimeout(2000);

    // Stop it
    await stopButton.click();

    // Verify input is empty (message already sent, not restored)
    await expect(input).toHaveValue('', { timeout: 2000 });

    // Verify stop button is hidden during cancellation
    await expect(stopButton).not.toBeVisible();

    // Wait for cancellation to complete - textarea becomes enabled
    await expect(input).toBeEnabled({ timeout: 10000 });

    // Verify conversation IS created (partial progress preserved)
    const res = await page.request.get('/api/conversations');
    const conversations = await res.json();
    expect(conversations.length).toBe(1);

    // Verify the conversation has a title (generated on stop)
    expect(conversations[0].title).not.toBe('New Chat');
  });

  test('should clear input and disable textarea during cancellation', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });
    const messageText = 'Tell me a long story about space exploration.';
    await input.fill(messageText);
    await input.press('Enter');

    // Wait for streaming to start
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Click stop
    await stopButton.click();

    // Input should be empty (message already sent, not restored)
    await expect(input).toHaveValue('', { timeout: 2000 });

    // Stop button is hidden during cancellation
    await expect(stopButton).not.toBeVisible({ timeout: 500 });

    // Wait for cancellation to complete - textarea becomes enabled
    await expect(input).toBeEnabled({ timeout: 10000 });

    // User can type a new message
    await input.focus();
    await page.keyboard.type('New message');
    await expect(input).toHaveValue('New message');
  });

  test('should stop SECOND message generation and preserve all progress', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Send first message to create conversation
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Hello');
    await input.press('Enter');

    // Wait for first message to complete
    await page.locator('.message.assistant').waitFor({ timeout: 20000 });
    // Handle if it's streaming, wait for stop button to go away
    await expect(page.locator('button.stop-btn')).not.toBeVisible({ timeout: 30000 });

    // Verify conversation created
    let res = await page.request.get('/api/conversations');
    let conversations = await res.json();
    expect(conversations.length).toBe(1);
    const conversationId = conversations[0].id;

    // 2. Send second message
    const secondMessage = 'Write a long poem about space.';
    await input.fill(secondMessage);
    await input.press('Enter');

    // Verify stop button appears
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible({ timeout: 10000 });

    // Wait a bit
    await page.waitForTimeout(1000);

    // Stop it
    await stopButton.click();
    await expect(stopButton).not.toBeVisible({ timeout: 10000 });

    // Verify input is empty (message already sent, not restored)
    await expect(input).toHaveValue('');

    // Verify conversation STILL exists with partial progress preserved
    // Now we expect MORE than 2 messages (first turn + second user message + partial response + stopped)
    await page.reload();
    const messagesAfterReload = page.locator('.message');
    // At minimum: first user + first assistant + second user = 3
    const count = await messagesAfterReload.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify conversation STILL exists
    res = await page.request.get('/api/conversations');
    conversations = await res.json();
    expect(conversations.length).toBe(1);
    expect(conversations[0].id).toBe(conversationId);
  });

  test('should resume after stop with correct message ordering across multiple turns', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.waitFor({ timeout: 10000 });

    // --- Turn 1: Normal question, let it complete ---
    await input.fill('What is the capital of France?');
    let responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(page);

    // Verify turn 1 completed
    const turn1Assistant = page.locator('.message.assistant').first();
    await expect(turn1Assistant).toBeVisible();
    const turn1Text = await turn1Assistant.textContent();
    expect(turn1Text).toContain('Paris');

    // --- Turn 2: Tool-heavy question, stop mid-stream ---
    await input.fill('Search the internet for "latest Mars mission news 2026" and give me a very detailed 2000 word summary.');
    responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;

    // Wait for streaming to start, then stop
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await stopButton.click();
    await expect(stopButton).not.toBeVisible({ timeout: 15000 });

    // Verify "User cancelled" shows up immediately (optimistic stopped event)
    const cancelledIndicator = page.getByText('User cancelled');
    await expect(cancelledIndicator).toBeVisible({ timeout: 5000 });

    // --- Turn 3: Ask a new question after stop ---
    await input.fill('What is 2+2?');
    responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(page, 60000);

    // "User cancelled" should still be visible (from the stopped turn)
    await expect(cancelledIndicator).toBeVisible();

    // The NEW assistant response (2+2=4) must be at the bottom, after everything else
    const allAssistants = page.locator('.message.assistant');
    const lastAssistantText = await allAssistants.last().textContent();
    expect(lastAssistantText).toContain('4');

    // The last user message must be the 2+2 question
    const allUsers = page.locator('.message.user');
    const lastUserText = await allUsers.last().textContent();
    expect(lastUserText).toContain('2+2');

    // --- Turn 4: One more question to confirm ordering stays correct ---
    await input.fill('What is the capital of Japan?');
    responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await responsePromise;
    await waitForChatCompletion(page, 60000);

    // The newest assistant response must be at the very bottom
    const finalAssistantText = await page.locator('.message.assistant').last().textContent();
    expect(finalAssistantText).toContain('Tokyo');

    // The newest user message must be the Japan question
    const finalUserText = await page.locator('.message.user').last().textContent();
    expect(finalUserText).toContain('Japan');

    // Total user messages: France + Mars + 2+2 + Japan = 4
    const userCount = await page.locator('.message.user').count();
    expect(userCount).toBe(4);
  });

  test('should stop Summary generation and NOT restore input', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message first
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Write a short story.');
    await input.press('Enter');
    await page.locator('.message.assistant').waitFor({ timeout: 20000 });
    await expect(page.locator('button.stop-btn')).not.toBeVisible({ timeout: 30000 });

    // Click Summarize button
    const summarizeButton = page.locator('button.summarize-button');
    await expect(summarizeButton).toBeVisible({ timeout: 5000 });
    await summarizeButton.click();

    // Verify stop button appears
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible();

    // Stop it
    await stopButton.click();
    await expect(stopButton).not.toBeVisible();

    // Verify input is EMPTY
    await expect(input).toHaveValue('');

    // Verify no streaming message remains (summary placeholder is gone)
    await expect(page.locator('.message.assistant.streaming')).toHaveCount(0);
  });

  test('should stop Verify generation and NOT restore input', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Send a message first
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('State a fact about cats.');
    await input.press('Enter');
    await page.locator('.message.assistant').waitFor({ timeout: 20000 });
    await expect(page.locator('button.stop-btn')).not.toBeVisible({ timeout: 30000 });

    // Click Verify button
    const verifyButton = page.locator('button.verify-button-main');
    await expect(verifyButton).toBeVisible({ timeout: 5000 });
    await verifyButton.click();

    // Verify stop button appears
    const stopButton = page.locator('button.stop-btn');
    await expect(stopButton).toBeVisible();

    // Stop it
    await stopButton.click();
    await expect(stopButton).not.toBeVisible({ timeout: 10000 });

    // Verify input is EMPTY
    await expect(input).toHaveValue('');

    // With new stop behavior, partial progress is preserved
    // We should have at least 2 messages from the first turn + verify user message
    const messages = page.locator('.message');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

});
