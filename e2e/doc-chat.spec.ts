import { test, expect } from '@playwright/test';
import { loadTestEnv, cleanupTestDb, setupPageWithUser, waitForApiResponse, waitForChatCompletion, clickNewDoc } from './test-utils';

loadTestEnv();

test.describe('Document Chat Features', () => {
  // Run tests in parallel
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async () => {
    // cleanupTestDb(); // Disabled to prevent race conditions in parallel mode
  });

  test('should navigate to chat from document "Ask" button', async ({ page }) => {
    await setupPageWithUser(page);

    // 1. Create a document
    await page.goto('/');
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//);

    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('Doc for AI');

    // Wait for auto-save to complete (look for "Saved" indicator)
    await page.waitForTimeout(1500);
    await expect(page.locator('.saved-indicator')).toBeVisible({ timeout: 5000 });

    const url = page.url();
    const docId = url.split('/doc/')[1];

    // 2. Click "Ask" - wait for it to be visible first
    const askAiButton = page.locator('button:has-text("Ask")');
    await expect(askAiButton).toBeVisible({ timeout: 10000 });
    await askAiButton.click();

    // 3. Verify navigation back to home with correct query param
    await expect(page).toHaveURL(/\/\?documentIds=.+/);
    expect(page.url()).toContain(`documentIds=${docId}`);

    // 4. Verify document context card is visible in chat
    const contextCard = page.locator('.messages-container').getByText('Doc for AI');
    await expect(contextCard).toBeVisible();

    // 5. Send a message
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What is this doc about?');

    const responsePromise = waitForApiResponse(page, '/api/chat');
    await input.press('Enter');
    await responsePromise;

    // 6. Verify conversation is created and URL changes
    await page.waitForURL(/\/chat\//);
    const assistantMessage = page.locator('.message.assistant');
    await expect(assistantMessage).toBeVisible();

    // Wait for completion
    await waitForChatCompletion(page);
  });

  test('should show past chats and navigate to them', async ({ page }) => {
    // Setup unique user for this test
    const user = await setupPageWithUser(page);

    // 1. Create a new document via API
    const docTitle = 'Test Doc for Past Chats';
    const docResponse = await page.request.post('/api/docs', {
      data: { title: docTitle, content: 'Test content' },
      headers: { 'Cookie': `auth-token=${user.token}` }
    });
    const doc = await docResponse.json();

    // 2. Navigate to the document page
    await page.goto(`/doc/${doc.id}`);
    await page.waitForLoadState('networkidle');

    // Verify we're on the doc page and it loaded
    await expect(page.locator('.document-title-input')).toHaveValue(docTitle);

    // 3. Click "Ask" button
    const askAiButton = page.locator('button:has-text("Ask")');
    await expect(askAiButton).toBeVisible({ timeout: 5000 });
    await askAiButton.click();

    // Should navigate to home with documentIds
    await expect(page).toHaveURL(`/?documentIds=${doc.id}`);

    // Reload to ensure everything is properly initialized
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 4. Send a message to create a conversation
    const input = page.locator('.chat-input');
    await input.waitFor({ timeout: 10000 });
    await input.fill('Tell me about this document');
    const secondResponsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');
    await secondResponsePromise;

    // 5. Wait for the conversation to appear in the sidebar (indicates it's been saved)
    const sidebarConversation = page.locator('.chat-item').first();
    await expect(sidebarConversation).toBeVisible({ timeout: 30000 });

    // Get the conversation ID from the URL
    await page.waitForURL(/\/chat\//);
    const chatUrl = page.url();
    const chatId = chatUrl.split('/chat/')[1];

    // 5. Wait for the Summarize button to appear (indicates chat is complete)
    // This prevents the "Gemini stream aborted by signal" error by ensuring the
    // server-side stream has finished processing before we reload or navigate.
    await waitForChatCompletion(page);

    // 7. Navigate back to the document page
    await page.goto(`/doc/${doc.id}`);
    await page.waitForLoadState('networkidle');

    // 8. Click "Chats" button
    const pastChatsButton = page.locator('button:has-text("Chats")');
    await expect(pastChatsButton).toBeVisible({ timeout: 5000 });
    await pastChatsButton.click();

    // 9. Verify the conversation appears in the past chats list
    const pastChatItem = page.locator('.past-chat-item').first();
    await expect(pastChatItem).toBeVisible({ timeout: 10000 });

    // 10. Click on the past chat item and verify navigation
    await pastChatItem.click();
    await expect(page).toHaveURL(`/chat/${chatId}`);
  });

  test('should show empty state and have fixed height for past chats panel', async ({ page }) => {
    await setupPageWithUser(page);

    // 1. Create doc
    await page.goto('/');
    await clickNewDoc(page);
    await page.waitForURL(/\/doc\//);

    // 2. Click "Chats"
    await page.locator('button:has-text("Chats")').click();

    // 3. Verify empty state message
    await expect(page.getByText('No past conversations for this document.')).toBeVisible();

    // 4. Verify fixed height for panel
    const panel = page.locator('.past-chats-panel');
    const box = await panel.boundingBox();
    // Allow small margin of error for height
    expect(box?.height).toBeGreaterThan(295);
    expect(box?.height).toBeLessThan(305);
  });
});
