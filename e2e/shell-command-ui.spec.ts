import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForChatCompletion } from './test-utils';

loadTestEnv();

test.describe('Shell Command Tool UI', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  async function sendPrompt(page: any, prompt: string) {
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(prompt);
    await input.press('Enter');
  }

  async function runShellCommandFromChat(page: any, command: string) {
    const prompt = [
      'Use the run_shell_command tool now.',
      `Run exactly this command: ${command}`,
      'Do not use any other tool.',
      'After running it, reply with: done',
    ].join(' ');

    await sendPrompt(page, prompt);
  }

  test('streams shell output while running', async ({ page }) => {
    test.setTimeout(120000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('#ai-provider').selectOption('gemini');

    const streamToken = `stream-e2e-${Date.now()}`;
    const command = `for i in 1 2 3 4; do echo "${streamToken}-$i"; sleep 1; done`;
    await runShellCommandFromChat(page, command);

    const toolHeader = page.locator('button', { hasText: 'run_shell_command' }).first();
    await expect(toolHeader).toBeVisible({ timeout: 60000 });
    await toolHeader.click();

    await expect(page.locator(`text=${streamToken}-1`).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator(`text=${streamToken}-4`).first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('text=Succeeded').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('text=exit: 0').first()).toBeVisible({ timeout: 10000 });

    await waitForChatCompletion(page);
  });

  test('shows sidebar running icon during active stream and clears after completion', async ({ page }) => {
    test.setTimeout(180000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#ai-provider').selectOption('gemini');

    const token = `sidebar-running-e2e-${Date.now()}`;
    const command = `for i in 1 2 3 4 5 6; do echo "${token}-$i"; sleep 1; done`;
    await runShellCommandFromChat(page, command);

    await page.waitForURL('**/chat/**', { timeout: 60000 });
    const activeSidebarItem = page.locator('.chat-item.active').first();
    await expect(activeSidebarItem).toBeVisible({ timeout: 30000 });
    await expect(activeSidebarItem.locator('.chat-item-icon-loading')).toBeVisible({ timeout: 30000 });

    await expect(page.locator('text=Succeeded').first()).toBeVisible({ timeout: 120000 });
    await waitForChatCompletion(page, 120000);
    await expect(activeSidebarItem.locator('.chat-item-icon-loading')).toHaveCount(0, { timeout: 30000 });
  });

  test('keeps completed shell job visible after page reload', async ({ page }) => {
    test.setTimeout(120000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('#ai-provider').selectOption('gemini');

    const persistToken = `persist-e2e-${Date.now()}`;
    const command = `echo "${persistToken}"`;
    await runShellCommandFromChat(page, command);

    const toolHeader = page.locator('button', { hasText: 'run_shell_command' }).first();
    await expect(toolHeader).toBeVisible({ timeout: 60000 });

    await waitForChatCompletion(page);
    await expect(page.locator('text=Succeeded').first()).toBeVisible({ timeout: 30000 });

    await toolHeader.click();
    await expect(page.locator(`text=${persistToken}`).first()).toBeVisible({ timeout: 15000 });

    await page.reload();
    await page.waitForLoadState('networkidle');

    const reloadedToolHeader = page.locator('button', { hasText: 'run_shell_command' }).first();
    await expect(reloadedToolHeader).toBeVisible({ timeout: 30000 });
    await expect(page.locator('text=Succeeded').first()).toBeVisible({ timeout: 10000 });

    await reloadedToolHeader.click();
    await expect(page.locator(`text=${persistToken}`).first()).toBeVisible({ timeout: 15000 });
  });

  test('generates an image with shell command and renders uploaded single image', async ({ page }) => {
    test.setTimeout(180000);
    await setupPageWithUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('#ai-provider').selectOption('gemini');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const prompt = `Can you create an image with python and upload it and render here.`;

    await input.fill(prompt);
    await input.press('Enter');

    // Wait for shell command tool to appear and succeed
    const shellToolHeader = page.locator('button', { hasText: 'run_shell_command' }).first();
    await expect(shellToolHeader).toBeVisible({ timeout: 60000 });
    await expect(page.locator('text=Succeeded').first()).toBeVisible({ timeout: 60000 });

    await waitForChatCompletion(page);

    // Verify the uploaded image is rendered in the assistant message
    const renderedImage = page.locator('.message.assistant img[src^="/uploads/"]').last();
    await expect(renderedImage).toBeVisible({ timeout: 30000 });

    const src = await renderedImage.getAttribute('src');
    expect(src).toMatch(/^\/uploads\/.*\.webp$/);

    const imageResponse = await page.request.get(`http://localhost:3001${src}`);
    expect(imageResponse.ok()).toBeTruthy();
    expect(imageResponse.headers()['content-type']).toContain('image/webp');
  });

});
