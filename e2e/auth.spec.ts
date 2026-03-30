import { test, expect } from '@playwright/test';
import { createUser } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { loadTestEnv, verifyTestDb } from './test-utils';

// Load test environment
loadTestEnv();

// Run once before all tests in this worker
test.beforeAll(async () => {
  if (process.env.VERIFY_DB !== 'false') {
    verifyTestDb();
    process.env.VERIFY_DB = 'false';
  }
});

test.describe('Authentication', () => {
  // Enable parallel mode for tests in this describe block
  test.describe.configure({ mode: 'parallel' });

  // We need to reset the storage state for these tests to be "logged out"
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should show login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
    await expect(page.locator('h1:has-text("Welcome Back")')).toBeVisible();
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    // Create a unique user for this test
    const userId = uuidv4();
    const email = `login-test-${userId}@example.com`;
    const password = 'password123';
    const hashedPassword = await hashPassword(password);
    await createUser(userId, email, hashedPassword);

    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    // Should redirect to home
    await expect(page).toHaveURL('/');

    // Check sidebar user info
    await expect(page.locator('.user-email')).toHaveText(email);
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    // Use unique non-existent email to avoid any conflicts
    const fakeEmail = `wrong-${uuidv4()}@example.com`;
    await page.getByPlaceholder('Email').fill(fakeEmail);
    await page.getByPlaceholder('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Login' }).click();

    // Should stay on login page and show error
    await expect(page.locator('text=Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('should logout successfully', async ({ page }) => {
    // Create a unique user for this test
    const userId = uuidv4();
    const email = `logout-test-${userId}@example.com`;
    const password = 'password123';
    const hashedPassword = await hashPassword(password);
    await createUser(userId, email, hashedPassword);

    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL('/');

    // Perform logout
    const logoutBtn = page.locator('.logout-btn');
    await logoutBtn.click();

    // Should redirect to login
    await expect(page).toHaveURL('/login');
  });
});
