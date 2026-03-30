import { test, expect } from '@playwright/test';
import * as path from 'path';
import {
  loadTestEnv,
  setupPageWithUser,
  clickNewApp,
  waitForChatCompletion,
} from './test-utils';

loadTestEnv();

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  return new Database(dbPath);
}

function getToolCallsForConversation(conversationId: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tool_name, arguments, status, response
    FROM tool_call_logs
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId);
  db.close();
  return rows.map((r: any) => ({
    ...r,
    arguments: JSON.parse(r.arguments || '{}'),
    response: r.response ? JSON.parse(r.response) : null,
  }));
}

test.describe('Coding Tools E2E - Model Usage', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('AI uses write_file, read_file, and patch_file in app chat', async ({ page }) => {
    test.setTimeout(240000);
    await setupPageWithUser(page);

    // --- Step 1: Create app from sidebar ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('CT E2E App');
    await titleInput.blur();
    await page.waitForTimeout(1500);

    // --- Step 2: Open app chat ---
    const chatBtn = page.locator('button').filter({ hasText: '+ Chat' });
    await expect(chatBtn).toBeVisible({ timeout: 5000 });
    await chatBtn.click();
    await page.waitForURL(/appId=/, { timeout: 10000 });

    await page.locator('#ai-provider').selectOption('gemini');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // --- Step 3: Create a file (sends first message, creates conversation) ---
    const token = `CT_E2E_${Date.now()}`;
    await input.fill(
      `Use the write_file tool to create a file called "app.js" with this exact content:\nconsole.log("${token}");\n`
    );
    await input.press('Enter');

    // Wait for the conversation URL to appear
    await page.waitForURL('**/chat/**', { timeout: 60000 });
    await waitForChatCompletion(page, 90000);

    // --- Step 4: Read and edit the file ---
    await input.fill(
      `First use read_file to read app.js, then use patch_file to change console.log to console.error in that file.`
    );
    await input.press('Enter');
    await waitForChatCompletion(page, 90000);

    // --- Step 5: Verify final state ---
    await input.fill(
      `Use read_file to read app.js and tell me its content.`
    );
    await input.press('Enter');
    await waitForChatCompletion(page, 60000);

    // The AI should confirm the file now has console.error
    const lastMessage = page.locator('.message.assistant').last();
    await expect(lastMessage).toContainText('console.error', { timeout: 10000 });

    // --- Step 6: Verify tool usage in database ---
    const chatUrl = page.url();
    const conversationId = chatUrl.split('/chat/')[1]?.split('?')[0];

    if (conversationId) {
      const toolCalls = getToolCallsForConversation(conversationId);
      const toolNames = toolCalls.map((t: any) => t.tool_name);

      // Should have used coding tools, not run_shell_command
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('patch_file');

      // write_file should have created app.js (path may be "app.js" or "app/app.js" depending on cwd)
      const writeCall = toolCalls.find((t: any) => t.tool_name === 'write_file');
      expect(writeCall.arguments.path).toMatch(/^(app\/)?app\.js$/);
      expect(writeCall.status).toBe('succeeded');

      // patch_file should have edited console.log → console.error
      const patchCall = toolCalls.find((t: any) => t.tool_name === 'patch_file');
      expect(patchCall.arguments.path).toMatch(/^(app\/)?app\.js$/);
      expect(patchCall.arguments.old_text).toContain('console.log');
      expect(patchCall.arguments.new_text).toContain('console.error');
      expect(patchCall.status).toBe('succeeded');

      // --- Step 7: Reload the page and verify coding tools still work ---
      const chatPageUrl = page.url();
      await page.goto(chatPageUrl);
      await page.waitForLoadState('networkidle');

      // Count tool calls before sending the post-reload message
      const preReloadCallCount = getToolCallsForConversation(conversationId).length;

      // Send another message — coding tools should still work after reload
      const reloadInput = page.locator('textarea[placeholder="Ask me anything..."]');
      await expect(reloadInput).toBeVisible({ timeout: 10000 });
      await reloadInput.fill('Use read_file to read app.js and tell me its content.');
      await reloadInput.press('Enter');
      await waitForChatCompletion(page, 60000);

      // Verify the AI used read_file after reload (not run_shell_command)
      const postReloadCalls = getToolCallsForConversation(conversationId);
      const newCalls = postReloadCalls.slice(preReloadCallCount);
      const newToolNames = newCalls.map((t: any) => t.tool_name);
      expect(newToolNames).toContain('read_file');
      expect(newToolNames).not.toContain('run_shell_command');

      // The AI response should show the file content
      const reloadMessage = page.locator('.message.assistant').last();
      await expect(reloadMessage).toContainText('console.error', { timeout: 10000 });
    }
  });
});
