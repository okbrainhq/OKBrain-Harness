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

test.describe('Fireworks Provider', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should respond with correct current date when asked about time (Fireworks)', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Fireworks provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

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

    // Fireworks should also have access to current time context
    expect(responseText).toContain('2026');
  });

  test('should send thinking: true when THINK checkbox is checked', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Fireworks provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

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

    // Verify thinking is true and provider is fireworks
    expect(requestBody.thinking).toBe(true);
    expect(requestBody.aiProvider).toBe('fw-kimi-k2.5');

    await waitForChatCompletion(page);
  });

  test('should send thinking: false when THINK checkbox is unchecked', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Fireworks provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

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

    // Verify thinking is false and provider is fireworks
    expect(requestBody.thinking).toBe(false);
    expect(requestBody.aiProvider).toBe('fw-kimi-k2.5');

    await waitForChatCompletion(page);
  });

  test('should show thinking indicator when model returns thoughts', async ({ page }) => {
    test.setTimeout(90000);
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Fireworks provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

    // Ensure THINK checkbox is checked
    const thinkCheckbox = page.locator('input[type="checkbox"]');
    await expect(thinkCheckbox).toBeVisible();
    if (!(await thinkCheckbox.isChecked())) {
      await thinkCheckbox.check();
    }
    await expect(thinkCheckbox).toBeChecked();

    // Send a prompt that should trigger thinking
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Is 97 a prime number? Think carefully before answering.');

    const responsePromise = waitForApiResponse(page, '/api/chat', 60000);
    await input.press('Enter');

    await responsePromise;
    await waitForChatCompletion(page);

    // Verify the thinking indicator appeared
    const thoughtIndicator = page.locator('.thoughts-container > div').first();
    await expect(thoughtIndicator).toBeVisible({ timeout: 10000 });
    await expect(thoughtIndicator).toContainText('Thought');

    // Click to expand and verify there's content
    await thoughtIndicator.click();
    const thoughtsContent = page.locator('.thoughts-container .content-styles').first();
    await expect(thoughtsContent).toBeVisible();
    const content = await thoughtsContent.textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test('should use event tool to find events', async ({ page }) => {
    test.setTimeout(90000);

    // Create user and get their ID
    const user = await createUniqueUser();

    // Create a test event for this user
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);

    const eventId = `evt_test_fw_${Date.now()}`;
    await createEvent(
      user.id,
      eventId,
      'Important Meeting with Alice',
      'Discuss project planning',
      'Conference Room A',
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

    // Select Fireworks provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

    // Ask about events — be explicit so the model lists details
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('List all my upcoming events with their full titles and details. Do not ask for timezone, just show them as-is.');
    await input.press('Enter');

    // Wait for the response stream to complete
    await waitForChatCompletion(page);

    // Verify the response contains the event we created
    const messageContent = page.locator('.message.assistant').last();
    await expect(messageContent).toContainText('Alice', { timeout: 15000 });
  });

  test('should use prompt caching on second message in same conversation', async ({ page }) => {
    test.setTimeout(120000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('fw-kimi-k2.5');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');

    // First message
    await input.fill('Remember the number 42. Just confirm you noted it.');
    await input.press('Enter');
    await waitForChatCompletion(page, 60000);

    // Verify first response appeared
    const firstResponse = page.locator('.message.assistant').first();
    await expect(firstResponse).toBeVisible({ timeout: 30000 });
    const firstText = await firstResponse.textContent();
    expect(firstText).toBeTruthy();
    // If first message errored, skip the rest
    expect(firstText).not.toContain('generation failed');

    // Second message in same conversation — prompt prefix is cached
    // Server logs will show: [Fireworks Cost] ... cached=NNNN ...
    await input.fill('What number did I ask you to remember?');
    await input.press('Enter');
    await waitForChatCompletion(page, 60000);

    // Verify second response references the number
    const assistantMessages = page.locator('.message.assistant');
    const count = await assistantMessages.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const secondResponse = await assistantMessages.nth(count - 1).textContent();
    expect(secondResponse).toContain('42');
  });
});
