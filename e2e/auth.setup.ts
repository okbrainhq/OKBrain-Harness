import { test as setup, expect } from '@playwright/test';
import { createUser } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { v4 as uuidv4 } from 'uuid';

import * as fs from 'fs';
import * as path from 'path';

const authFile = 'playwright/.auth/user.json';
const userInfoFile = 'playwright/.auth/user-info.json';

setup('authenticate', async ({ page }) => {
  // Create a test user directly in the database
  const email = 'test@example.com';
  const password = 'password123';
  const hashedPassword = await hashPassword(password);
  const userId = uuidv4();

  // We need to suppress the console logs from db.ts potentially
  try {
    await createUser(userId, email, hashedPassword);
  } catch (e) {
    // Ignore if user already exists (might happen if cleanup fails)
    console.log('User might already exist, proceeding to login');
  }

  // Perform login via UI to get the session cookie
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for redirect to home
  await page.waitForURL('/');

  // Save storage state using proper path
  await page.context().storageState({ path: authFile });

  // Save user info for test usage (to restore user after cleanup)
  fs.writeFileSync(userInfoFile, JSON.stringify({ id: userId, email }));
});
