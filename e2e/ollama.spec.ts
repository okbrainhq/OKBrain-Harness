import { test, expect } from '@playwright/test';
import { loadTestEnv, waitForApiResponse, verifyTestDb, setupPageWithUser, waitForChatCompletion, createUniqueUser, seedFreshHighlights } from './test-utils';
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

// Helper to skip if Ollama model is not available
async function selectOllamaModel(page: any) {
  const providerSelect = page.locator('#ai-provider');
  const ollamaOption = providerSelect.locator('option[value="qwen3.5-4b"]');
  if (await ollamaOption.count() === 0) {
    test.skip(true, 'Ollama model is not available in this test environment');
  }
  await providerSelect.selectOption('qwen3.5-4b');
}

test.describe('Ollama Provider Specifics', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should respond with correct current date when asked about time (Ollama)', async ({ page }) => {
    test.setTimeout(120000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Ollama provider
    await selectOllamaModel(page);

    // Send a message asking about the current time/date
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill("What is today's date?");

    const responsePromise = waitForApiResponse(page, '/api/chat', 90000);
    await page.locator('textarea[placeholder="Ask me anything..."]').press('Enter');

    await responsePromise;
    await waitForChatCompletion(page, 90000);

    const assistantMessages = page.locator('.message.assistant');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 30000 });

    const responseText = await assistantMessages.first().textContent();

    // Ollama should have access to current time context
    expect(responseText).toContain('2026');
  });
});

test.describe('Ollama Thinking Mode', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should send thinking: true when THINK checkbox is checked', async ({ page }) => {
    test.setTimeout(180000);
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Ollama provider
    await selectOllamaModel(page);

    // Verify THINK checkbox is visible and check it
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

    // Verify thinking is true and provider is ollama
    expect(requestBody.thinking).toBe(true);
    expect(requestBody.aiProvider).toBe('qwen3.5-4b');

    await waitForChatCompletion(page, 150000);
  });

  test('should send thinking: false when THINK checkbox is unchecked', async ({ page }) => {
    test.setTimeout(180000);
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Ollama provider
    await selectOllamaModel(page);

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

    // Verify thinking is false and provider is ollama
    expect(requestBody.thinking).toBe(false);
    expect(requestBody.aiProvider).toBe('qwen3.5-4b');

    await waitForChatCompletion(page, 150000);
  });
});

test.describe('Ollama Status and Tools', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should use event tool to find events', async ({ page }) => {
    test.setTimeout(180000);

    // Create user and get their ID
    const user = await createUniqueUser();

    // Create a test event for this user
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);

    const eventId = `evt_test_ol_${Date.now()}`;
    await createEvent(
      user.id,
      eventId,
      'Important Meeting with Charlie',
      'Discuss product design',
      'Conference Room C',
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

    // Select Ollama provider
    await selectOllamaModel(page);

    // Ask about events — be explicit so the model lists details
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('List all my upcoming events with their full titles and details. Do not ask for timezone, just show them as-is.');
    await input.press('Enter');

    // Wait for the response stream to complete (Ollama + tool calls can be slow)
    await waitForChatCompletion(page, 150000);

    // Verify the response contains the event we created
    const messageContent = page.locator('.message.assistant').last();
    await expect(messageContent).toContainText('Charlie', { timeout: 15000 });
  });
});
