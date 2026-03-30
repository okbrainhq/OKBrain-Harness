import { test, expect, request } from '@playwright/test';
import { loadTestEnv, verifyTestDb, setupPageWithUser, createUniqueUser, clickNewApp, waitForChatCompletion } from './test-utils';

loadTestEnv();

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

async function createApiContextForUser(token: string) {
  return await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: { 'Cookie': `auth-token=${token}` },
  });
}

async function createAuthContext() {
  const user = await createUniqueUser();
  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: {
      'Cookie': `auth-token=${user.token}`,
    },
  });
  return { context, user };
}

test.describe('Apps Feature', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show App option in New dropdown', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newBtn = page.locator('.new-btn');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();

    const dropdown = page.locator('.new-menu-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await expect(dropdown.locator('text=App')).toBeVisible();
  });

  test('should create an app and navigate to it @smoke', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);

    // Should navigate to app page
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Title input should be visible with default title
    const titleInput = page.locator('.document-title-input');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('Untitled App');
  });

  test('should show app in sidebar after creation', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // App should appear in sidebar
    const sidebarItem = page.locator('.chat-item').filter({ hasText: 'Untitled App' });
    await expect(sidebarItem).toBeVisible({ timeout: 5000 });
  });

  test('should have Chats, README, DEV, Files, Secrets tabs', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Verify tabs exist
    await expect(page.locator('.tab-bar-item').filter({ hasText: 'Chats' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tab-bar-item').filter({ hasText: 'README' })).toBeVisible();
    await expect(page.locator('.tab-bar-item').filter({ hasText: 'DEV' })).toBeVisible();
    await expect(page.locator('.tab-bar-item').filter({ hasText: 'Files' })).toBeVisible();
    await expect(page.locator('.tab-bar-item').filter({ hasText: 'Secrets' })).toBeVisible();

    // Chats tab should be active by default
    await expect(page.locator('.tab-bar-item-active').filter({ hasText: 'Chats' })).toBeVisible();
  });

  test('should show DEV.md editor and save content', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Click DEV tab
    await page.locator('.tab-bar-item').filter({ hasText: 'DEV' }).click();

    // Should show the textarea editor with content loaded
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Should have content (either from auto-created DEV.md or the template)
    await expect(textarea).not.toHaveValue('');

    // Edit the content
    await textarea.fill('# Custom Dev Notes\n\nSome dev notes here.');

    // Status should show Unsaved
    await expect(page.locator('text=Unsaved')).toBeVisible();

    // Click Save
    await page.locator('button').filter({ hasText: 'Save' }).click();

    // Status should show Saved
    await expect(page.locator('text=Saved')).toBeVisible({ timeout: 5000 });

    // Switch away and back to verify persistence
    await page.locator('.tab-bar-item').filter({ hasText: 'Chats' }).click();
    await page.waitForTimeout(300);
    await page.locator('.tab-bar-item').filter({ hasText: 'DEV' }).click();

    // Content should still be there
    await expect(textarea).toHaveValue('# Custom Dev Notes\n\nSome dev notes here.', { timeout: 5000 });
  });

  test('should open app when clicking sidebar item', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });
    const appUrl = page.url();

    // Navigate away
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the app in sidebar
    const sidebarItem = page.locator('.chat-item').filter({ hasText: 'Untitled App' });
    await expect(sidebarItem).toBeVisible({ timeout: 5000 });
    await sidebarItem.click();

    // Should navigate back to the app page
    await page.waitForURL(/\/app\//, { timeout: 10000 });
    const titleInput = page.locator('.document-title-input');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('Untitled App');
  });

  test('should rename app from sidebar', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Change title via the title input
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('My Test App');
    await titleInput.blur();

    // Wait for auto-save (1s debounce + network)
    await page.waitForTimeout(1500);

    // Verify sidebar shows new title
    const sidebarItem = page.locator('.chat-item').filter({ hasText: 'My Test App' });
    await expect(sidebarItem).toBeVisible({ timeout: 5000 });
  });

  test('should create app via API', async () => {
    const { context } = await createAuthContext();

    const response = await context.post('/api/apps', {
      data: { title: 'API Test App' },
    });
    expect(response.status()).toBe(200);

    const app = await response.json();
    expect(app.id).toBeTruthy();
    expect(app.title).toBe('API Test App');
    expect(app.description).toBe('');

    // Get the app
    const getResponse = await context.get(`/api/apps/${app.id}`);
    expect(getResponse.status()).toBe(200);
    const fetchedApp = await getResponse.json();
    expect(fetchedApp.title).toBe('API Test App');

    // Delete the app
    const deleteResponse = await context.delete(`/api/apps/${app.id}`);
    expect(deleteResponse.status()).toBe(200);

    await context.dispose();
  });

  test('should create DEV.md when app is created', async () => {
    const { context } = await createAuthContext();

    const response = await context.post('/api/apps', {
      data: { title: 'DEV.md Test App' },
    });
    expect(response.status()).toBe(200);
    const app = await response.json();

    // DEV.md should be auto-created in the app directory
    const readRes = await context.get(`/api/filebrowser/fs/read?path=${encodeURIComponent(`apps/${app.id}/DEV.md`)}`);
    expect(readRes.status()).toBe(200);
    const data = await readRes.json();

    // Verify key sections exist
    expect(data.content).toContain('# Development Guide');
    expect(data.content).toContain('## Entry Point');
    expect(data.content).toContain('./run');
    expect(data.content).toContain('## Testing');
    expect(data.content).toContain('e2e style');
    expect(data.content).toContain('test database');
    expect(data.content).toContain('## Workflow');

    await context.dispose();
  });

  test('should update app title and description via API', async () => {
    const { context } = await createAuthContext();

    const createResponse = await context.post('/api/apps', {
      data: { title: 'Update Test' },
    });
    const app = await createResponse.json();

    const patchResponse = await context.patch(`/api/apps/${app.id}`, {
      data: { title: 'Updated Title', description: 'A cool app' },
    });
    expect(patchResponse.status()).toBe(200);

    const updated = await patchResponse.json();
    expect(updated.title).toBe('Updated Title');
    expect(updated.description).toBe('A cool app');

    await context.dispose();
  });
});

test.describe('App Secrets', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should manage secrets via API', async () => {
    const { context } = await createAuthContext();

    // Create app
    const appRes = await context.post('/api/apps', {
      data: { title: 'Secret Test App' },
    });
    const app = await appRes.json();

    // Add a secret
    const addRes = await context.post(`/api/apps/${app.id}/secrets`, {
      data: { key: 'API_KEY', value: 'sk-test-123' },
    });
    expect(addRes.status()).toBe(200);

    // List secrets
    const listRes = await context.get(`/api/apps/${app.id}/secrets`);
    expect(listRes.status()).toBe(200);
    const secrets = await listRes.json();
    expect(secrets).toHaveLength(1);
    expect(secrets[0].key).toBe('API_KEY');
    expect(secrets[0].value).toBe('sk-test-123');

    // Update a secret
    const updateRes = await context.post(`/api/apps/${app.id}/secrets`, {
      data: { key: 'API_KEY', value: 'sk-updated-456' },
    });
    expect(updateRes.status()).toBe(200);

    const updatedSecrets = await (await context.get(`/api/apps/${app.id}/secrets`)).json();
    expect(updatedSecrets).toHaveLength(1);
    expect(updatedSecrets[0].value).toBe('sk-updated-456');

    // Delete a secret
    const deleteRes = await context.delete(`/api/apps/${app.id}/secrets`, {
      data: { key: 'API_KEY' },
    });
    expect(deleteRes.status()).toBe(200);

    const emptySecrets = await (await context.get(`/api/apps/${app.id}/secrets`)).json();
    expect(emptySecrets).toHaveLength(0);

    await context.dispose();
  });

  test('should reject invalid secret key format', async () => {
    const { context } = await createAuthContext();

    const appRes = await context.post('/api/apps', {
      data: { title: 'Key Validation App' },
    });
    const app = await appRes.json();

    // Invalid: starts with number
    const res = await context.post(`/api/apps/${app.id}/secrets`, {
      data: { key: '123_BAD', value: 'test' },
    });
    expect(res.status()).toBe(400);

    await context.dispose();
  });

  test('should show secrets panel UI', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Click Secrets tab
    await page.locator('.tab-bar-item').filter({ hasText: 'Secrets' }).click();

    // Should show empty state
    await expect(page.locator('text=No secrets configured')).toBeVisible({ timeout: 5000 });

    // Should show key/value inputs
    const keyInput = page.locator('input[placeholder="KEY_NAME"]');
    await expect(keyInput).toBeVisible();

    const valueInput = page.locator('input[placeholder="Secret value"]');
    await expect(valueInput).toBeVisible();
  });

  test('should add and display a secret in UI', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Click Secrets tab
    await page.locator('.tab-bar-item').filter({ hasText: 'Secrets' }).click();
    await page.waitForTimeout(300);

    // Add a secret
    await page.locator('input[placeholder="KEY_NAME"]').fill('MY_SECRET');
    await page.locator('input[placeholder="Secret value"]').fill('super-secret-value');
    await page.locator('button').filter({ hasText: 'Add' }).click();

    // Wait for the secret to appear
    await expect(page.locator('text=MY_SECRET')).toBeVisible({ timeout: 5000 });

    // Value should be masked (bullet characters)
    const maskedValue = page.locator('span').filter({ hasText: /^\u2022+$/ });
    await expect(maskedValue.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('App End-to-End Flow', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('create app from UI, build it in app chat, run it from separate chat', async ({ page }) => {
    test.setTimeout(180000);
    await setupPageWithUser(page);

    const token = `E2E_APP_${Date.now()}`;

    // --- Step 1: Create app from sidebar ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await clickNewApp(page);
    await page.waitForURL(/\/app\//, { timeout: 10000 });

    // Rename the app
    const titleInput = page.locator('.document-title-input');
    await titleInput.fill('Echo Tool');
    await titleInput.blur();
    await page.waitForTimeout(1500); // wait for auto-save

    // Get the app ID from URL
    const appUrl = page.url();
    const appId = appUrl.split('/app/')[1];

    // --- Step 2: Click "+ Chat" to open app chat ---
    const chatBtn = page.locator('button').filter({ hasText: '+ Chat' });
    await expect(chatBtn).toBeVisible({ timeout: 5000 });
    await chatBtn.click();

    // Should navigate to home with appId
    await page.waitForURL(/appId=/, { timeout: 10000 });

    // App context card should be visible
    await expect(page.locator('text=App: Echo Tool').first()).toBeVisible({ timeout: 10000 });

    // Select gemini for reliable tool use
    await page.locator('#ai-provider').selectOption('gemini');

    // --- Step 3: Ask AI to create the app's entry point (~/app/run) ---
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(
      `Use the run_shell_command tool now. Run exactly this command: printf '#!/bin/bash\\necho "${token}"\\n' > ~/app/run && chmod +x ~/app/run && cat ~/app/run Do not use any other tool. After running it, reply with: done`
    );
    await input.press('Enter');

    // Wait for tool to run
    const toolHeader1 = page.locator('button', { hasText: 'run_shell_command' }).first();
    await expect(toolHeader1).toBeVisible({ timeout: 60000 });
    await waitForChatCompletion(page);

    // Verify the entry point was created (expand tool output)
    await toolHeader1.click();
    await expect(page.locator(`text=${token}`).first()).toBeVisible({ timeout: 10000 });

    // --- Step 4: Open a NEW regular chat (no app context) and run the app ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#ai-provider').selectOption('gemini');

    const input2 = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input2).toBeVisible({ timeout: 10000 });
    await input2.fill(
      `Run the "Echo Tool" app with no arguments.`
    );
    await input2.press('Enter');

    await waitForChatCompletion(page);

    // The AI should have used discover_apps/app_info/run_app which calls ~/app/run
    // The token from the entry point should appear somewhere on the page
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain(token);
  });
});

test.describe('App run_app CLI & State', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('run_app can read, execute, and write state in ~/app', async ({ page }) => {
    test.setTimeout(120000);
    const user = await setupPageWithUser(page);
    const apiContext = await createApiContextForUser(user.token);

    // Create app with a CLI script that reads a file and writes state
    const appRes = await apiContext.post('/api/apps', { data: { title: 'Stateful App' } });
    const app = await appRes.json();
    await apiContext.post('/api/filebrowser/fs/mkdir', { data: { path: `apps/${app.id}` } });

    const token = `STATE_${Date.now()}`;
    // Entry point: ~/app/run — accepts write/read subcommands
    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${app.id}/run`,
        content: `#!/bin/bash
case "$1" in
  write)
    echo "${token}" > ~/app/state.txt
    echo "WRITE_OK"
    ;;
  read)
    cat ~/app/state.txt 2>/dev/null || echo "NO_STATE"
    ;;
  *)
    echo "Usage: run [write|read]"
    ;;
esac
`,
      },
    });
    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${app.id}/README.md`,
        content: `# Stateful App\n\n## CLI\n\n- \`write\` — saves state\n- \`read\` — reads saved state\n`,
      },
    });

    // Ask naturally to run the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#ai-provider').selectOption('gemini');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(
      `Run the "Stateful App". First write some state, then read it back.`
    );
    await input.press('Enter');
    await waitForChatCompletion(page);

    const pageContent = await page.textContent('body');
    // App should be able to write state and read it back
    expect(pageContent).toContain('WRITE_OK');
    expect(pageContent).toContain(token);

    await apiContext.dispose();
  });

  test('run_app passes quoted multi-word args as single argument', async ({ page }) => {
    test.setTimeout(120000);
    const user = await setupPageWithUser(page);
    const apiContext = await createApiContextForUser(user.token);

    // Create app that echoes each arg on its own line
    const appRes = await apiContext.post('/api/apps', { data: { title: 'Args App' } });
    const app = await appRes.json();
    await apiContext.post('/api/filebrowser/fs/mkdir', { data: { path: `apps/${app.id}` } });

    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${app.id}/run`,
        content: `#!/bin/bash\nfor arg in "$@"; do echo "ARG:$arg"; done\n`,
      },
    });
    await apiContext.post('/api/filebrowser/fs/write', {
      data: {
        path: `apps/${app.id}/README.md`,
        content: `# Args App\n\nEchoes each argument on its own line prefixed with ARG:.\n\n## CLI\n\n\`\`\`\nrun <args...>\n\`\`\`\n`,
      },
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#ai-provider').selectOption('gemini');

    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(
      `Run the "Args App" with these exact arguments: "hello world" --flag`
    );
    await input.press('Enter');
    await waitForChatCompletion(page);

    const pageContent = await page.textContent('body');
    // "hello world" should arrive as a single arg, not split into two
    expect(pageContent).toContain('ARG:hello world');
    expect(pageContent).toContain('ARG:--flag');

    await apiContext.dispose();
  });
});
