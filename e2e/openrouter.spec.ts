import { test, expect } from '@playwright/test';
import * as path from 'path';
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

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  return new Database(dbPath);
}

function getConversationShellJobs(conversationId: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT *
    FROM conversation_tool_jobs
    WHERE conversation_id = ?
      AND tool_name = 'run_shell_command'
    ORDER BY created_at ASC, id ASC
  `).all(conversationId);
  db.close();
  return rows;
}

function parseJson(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Read model IDs directly from the provider definition file.
// This way tests always pick whatever model is currently active.
function getOpenRouterModelIds(): string[] {
  const fs = require('fs');
  const providerPath = path.resolve(__dirname, '../src/lib/ai/providers/openrouter.ts');
  const source = fs.readFileSync(providerPath, 'utf-8');

  // Match uncommented id: "..." lines inside models array
  const ids: string[] = [];
  // Only match lines that aren't inside comments (no leading //)
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const match = trimmed.match(/^\s*id:\s*"([^"]+)"/);
    if (match) ids.push(match[1]);
  }
  return ids;
}

// Select the first available OpenRouter model in the dropdown
async function selectOpenRouterModel(page: any): Promise<string> {
  const modelIds = getOpenRouterModelIds();
  if (modelIds.length === 0) {
    test.skip(true, 'No OpenRouter models defined in provider file');
    return '';
  }

  const providerSelect = page.locator('#ai-provider');
  for (const id of modelIds) {
    const option = providerSelect.locator(`option[value="${id}"]`);
    if (await option.count() > 0) {
      await providerSelect.selectOption(id);
      return id;
    }
  }

  test.skip(true, 'No OpenRouter model is available in this test environment');
  return '';
}

test.describe('OpenRouter Provider Specifics', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should respond with correct current date when asked about time (OpenRouter)', async ({ page }) => {
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select OpenRouter provider
    await selectOpenRouterModel(page);

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

    // OpenRouter should also have access to current time context
    expect(responseText).toContain('2026');
  });
});

test.describe('OpenRouter Thinking Mode', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should send thinking: true when THINK checkbox is checked', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select OpenRouter provider
    const modelId = await selectOpenRouterModel(page);

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

    // Verify thinking is true and provider is openrouter
    expect(requestBody.thinking).toBe(true);
    expect(requestBody.aiProvider).toBe(modelId);

    await waitForChatCompletion(page);
  });

  test('should send thinking: false when THINK checkbox is unchecked', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select OpenRouter provider
    const modelId = await selectOpenRouterModel(page);

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

    // Verify thinking is false and provider is openrouter
    expect(requestBody.thinking).toBe(false);
    expect(requestBody.aiProvider).toBe(modelId);

    await waitForChatCompletion(page);
  });

  test('should show thinking indicator when model returns thoughts', async ({ page }) => {
    test.setTimeout(90000);
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select MiniMax model which always returns thinking tokens
    const providerSelect = page.locator('#ai-provider');
    const miniMaxOption = providerSelect.locator('option[value="or-minimax-m2.7"]');
    if (await miniMaxOption.count() === 0) {
      test.skip(true, 'MiniMax test model not available (TEST_MODE not set)');
      return;
    }
    await providerSelect.selectOption('or-minimax-m2.7');

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
});

test.describe('OpenRouter Status and Tools', () => {
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

    const eventId = `evt_test_or_${Date.now()}`;
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

    // Select OpenRouter provider
    await selectOpenRouterModel(page);

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

  test('qwen dedupes duplicate shell tool calls by append then read workflow', async ({ page }) => {
    test.setTimeout(240000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const providerSelect = page.locator('#ai-provider');
    const qwenOption = providerSelect.locator('option[value="qwen3.5-35b-a3b"]');
    if (await qwenOption.count() === 0) {
      test.skip(true, 'Qwen model is not available in this test environment');
    }

    await providerSelect.selectOption('qwen3.5-35b-a3b');

    const token = `qwen-dedupe-${Date.now()}`;
    const filePath = `/home/brain-sandbox/${token}.txt`;
    const appendCommand = `printf "${token}\\n" >> ${filePath}`;
    const readCommand = `grep -c '^${token}$' ${filePath} || true`;

    const input = page.locator('textarea[placeholder="Ask me anything..."]');

    const appendPrompt = [
      'Use the run_shell_command tool now.',
      'Call run_shell_command with the exact same command three times in this turn before replying.',
      `Run exactly this command: ${appendCommand}`,
      'Do not use any other tool.',
      'Reply with done.',
    ].join(' ');
    await input.fill(appendPrompt);
    await input.press('Enter');
    await expect(page.locator('button', { hasText: 'run_shell_command' }).first()).toBeVisible({ timeout: 60000 });
    await waitForChatCompletion(page);

    const readPrompt = [
      'Use the run_shell_command tool now.',
      `Run exactly this command: ${readCommand}`,
      'Do not use any other tool.',
      'Reply with done.',
    ].join(' ');
    await input.fill(readPrompt);
    await input.press('Enter');
    await waitForChatCompletion(page);

    const url = page.url();
    expect(url).toContain('/chat/');
    const conversationId = url.split('/chat/')[1]?.split('?')[0];
    expect(conversationId).toBeTruthy();

    const jobs = getConversationShellJobs(conversationId!);
    const appendJobs = jobs.filter((job) => parseJson(job.metadata)?.command === appendCommand);
    const readJobs = jobs.filter((job) => parseJson(job.metadata)?.command === readCommand);

    expect(appendJobs.length).toBe(1);
    expect(readJobs.length).toBe(1);

    const readOutput = parseJson(readJobs[0].output);
    const readStdout = String(readOutput?.stdout || '').trim();
    expect(readStdout).toBe('1');
  });
});
