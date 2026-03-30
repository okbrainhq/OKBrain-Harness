import { test, expect, Page } from '@playwright/test';
import { setupPageWithUser } from './test-utils';

test.describe('Location Tracking', () => {
  // Mock Geolocation
  const mockLocation = {
    latitude: 40.7128, // New York
    longitude: -74.0060
  };

  test.beforeEach(async ({ page, context }) => {
    // Setup fresh user with seeded highlights to prevent background regeneration
    await setupPageWithUser(page);

    // Navigate to home
    await page.goto('/');

    // Clear location-related storage to ensure a clean state for each test
    await page.evaluate(() => {
      localStorage.removeItem('user:location');
      localStorage.removeItem('chat:isTrackingEnabled');
    });

    // Grant permission & set mock location by default
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(mockLocation);
  });

  test('Test Case 1: Tracking disabled (default) -> Enable -> Verify Location Sent', async ({ page }) => {
    // 1. Verify tracking is enabled by default (per requirements, it says "Enabled by default")
    // The toggle is now on the home page's top right
    const toggle = page.locator('.location-toggle-btn').first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveClass(/active/); // Should be active by default

    // 2. Disable it
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);

    // 3. Send message, intercept request to verify NO location
    await page.route('/api/chat', async route => {
      const postData = route.request().postDataJSON();
      expect(postData.location).toBeUndefined();
      await route.fulfill({ json: { jobId: 'mock-job-id', messageId: 'mock-msg-id', conversationId: 'mock-conv-id' } });
    });

    await page.fill('textarea', 'What city is this?');
    await page.keyboard.press('Enter');

    // Wait for the route handler to be called
    await page.waitForTimeout(500);

    // 4. Reset to home to show the toggle again (since messages > 0 hides it)
    await page.goto('/');
    await expect(toggle).not.toHaveClass(/active/);

    // 5. Enable it
    await toggle.click();
    await expect(toggle).toHaveClass(/active/);

    // 6. Send message, intercept request to verify location IS present
    const requestPromise = page.waitForRequest(req => req.url().includes('/api/chat') && req.method() === 'POST');

    await page.fill('textarea', 'What city is this now?');
    await page.keyboard.press('Enter');

    const request = await requestPromise;
    const postData = request.postDataJSON();

    expect(postData.location).toBeDefined();
    expect(postData.location).toContain(`${mockLocation.latitude},${mockLocation.longitude}`);
  });

  test('Test Case 3: Fresh location uses stored value immediately', async ({ page }) => {
    // 1. Ensure tracking is on (toggle is on home page)
    await expect(page.locator('.location-toggle-btn').first()).toHaveClass(/active/);

    // 2. Pre-seed local storage with a "fresh" location
    const freshLocation = {
      lat: mockLocation.latitude,
      lng: mockLocation.longitude,
      lastUpdated: Date.now()
    };

    await page.evaluate((loc) => {
      localStorage.setItem('user:location', JSON.stringify(loc));
    }, freshLocation);

    // 3. Reload to pick up storage
    await page.reload();

    // 4. Mock API to respond quickly
    await page.route('/api/chat', async route => {
      const postData = route.request().postDataJSON();
      expect(postData.location).toBe(`${mockLocation.latitude},${mockLocation.longitude}`);
      await route.fulfill({ json: { jobId: 'mock-job', conversationId: 'mock-conv' } });
    });

    // 5. Send message
    await page.fill('textarea', 'Hello');

    // Measure time to send - should be instant, no "Getting location..." status
    const start = Date.now();
    await page.keyboard.press('Enter');

    // Verify we didn't see the "Getting location..." status
    const statusCtn = page.locator('.chat-status');
    if (await statusCtn.isVisible()) {
      await expect(statusCtn).not.toContainText('Getting location');
    }
  });

  test('Test Case 4: Slow GPS triggers status message', async ({ page, context }) => {
    // 1. Clear stored location to force fetch
    await page.evaluate(() => localStorage.removeItem('user:location'));

    // 2. Mock slow geolocation
    // Note: Playwright's setGeolocation is instant. To mock delay, we must
    // mock the navigator.geolocation API in the page context.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: (success: any, error: any, options: any) => {
            // Delay 3 seconds
            setTimeout(() => {
              success({
                coords: {
                  latitude: 40.7128,
                  longitude: -74.0060,
                  accuracy: 10,
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null
                },
                timestamp: Date.now()
              });
            }, 3000);
          },
          watchPosition: () => 0,
          clearWatch: () => { }
        },
        configurable: true
      });
    });

    // Reload to ensure the mock takes effect
    await page.reload();

    // 3. Send message
    await page.fill('textarea', 'Locate me');
    await page.keyboard.press('Enter');

    // 4. Verify "Getting location" appears
    // It should appear after 2 seconds
    await expect(page.locator('.message-status').first()).toContainText('Getting location', { timeout: 4000 });
  });
});
