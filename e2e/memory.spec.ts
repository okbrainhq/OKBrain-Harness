import { test, expect } from '@playwright/test';
import { setupPageWithUser, waitForApiResponse } from './test-utils';

test.describe('User Memory UI', () => {
  test('should navigate to memory page from sidebar', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/');

    // Click profile icon in sidebar
    const profileBtn = page.locator('button[title="Profile"]');
    await expect(profileBtn).toBeVisible();
    await profileBtn.click();

    // Verify navigation to /me
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.locator('.me-page-title h1')).toHaveText('User Memory');
  });

  test('should display empty state when no memory exists', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/me');

    // Wait for content to load
    await expect(page.locator('.me-empty-state')).toBeVisible();
    await expect(page.locator('text=No memory recorded yet.')).toBeVisible();
  });

  test('should allow manual editing and saving of memory', async ({ page }) => {
    await setupPageWithUser(page);
    await page.goto('/me');

    // Click Edit
    await page.locator('button:has-text("Edit")').click();

    // Fill textarea
    const testMemory = '# Test Memory\n\n- Skill: Playwright testing\n- Preference: Dark mode';
    await page.locator('.me-textarea').fill(testMemory);

    // Save
    const savePromise = waitForApiResponse(page, '/api/memory');
    await page.locator('button:has-text("Save")').click();
    await savePromise;

    // Verify preview
    await expect(page.locator('.me-markdown-preview h1')).toHaveText('Test Memory');
    await expect(page.locator('.me-markdown-preview ul li')).toHaveText([
      'Skill: Playwright testing',
      'Preference: Dark mode'
    ]);
  });
});
