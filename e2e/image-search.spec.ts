import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser, waitForChatCompletion } from './test-utils';
import { imageSearchTools } from '../src/lib/ai/tools/image-search';
import { parseImageBlocks } from '../src/app/components/ImageGallery';

loadTestEnv();

// Mock Brave API response
const MOCK_BRAVE_RESPONSE = {
  type: 'images',
  results: [
    {
      title: 'Golden Gate Bridge at Sunset',
      url: 'https://example.com/gg-bridge.jpg',
      source: 'example.com',
      meta_url: { scheme: 'https', netloc: 'example.com', path: '/photos/gg-bridge' },
      thumbnail: { src: 'https://imgs.example.com/thumb/gg1.jpg', width: 200, height: 150 },
      properties: { url: 'https://example.com/gg-bridge-full.jpg', width: 1920, height: 1080 },
    },
    {
      title: 'Golden Gate Bridge Aerial View',
      url: 'https://example2.com/gg-aerial.jpg',
      source: 'example2.com',
      meta_url: { scheme: 'https', netloc: 'example2.com', path: '/images/aerial' },
      thumbnail: { src: 'https://imgs.example.com/thumb/gg2.jpg', width: 200, height: 150 },
      properties: { url: 'https://example2.com/gg-aerial-full.jpg', width: 1600, height: 900 },
    },
    {
      title: 'Bridge at Night',
      url: 'https://example3.com/bridge-night.jpg',
      source: 'example3.com',
      meta_url: { scheme: 'https', netloc: 'example3.com', path: '/gallery/night' },
      thumbnail: { src: 'https://imgs.example.com/thumb/gg3.jpg', width: 200, height: 150 },
      properties: { url: 'https://example3.com/bridge-night-full.jpg', width: 1200, height: 800 },
    },
  ],
};

// --- Tool Unit Tests ---

test.describe('Image Search Tool - Unit Tests', () => {
  const getTool = () => imageSearchTools.find(t => t.definition.name === 'image_search');

  test('should have correct tool definition', () => {
    const tool = getTool();
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('image_search');
    expect(tool!.definition.parameters.required).toContain('searches');
    expect(tool!.definition.parameters.properties).toHaveProperty('searches');
    expect(tool!.definition.parameters.properties.searches.type).toBe('ARRAY');
    expect(tool!.definition.parameters.properties.searches.items.properties).toHaveProperty('query');
    expect(tool!.definition.parameters.properties.searches.items.properties).toHaveProperty('count');
  });

  test('should return error when no API key is set', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;

    const tool = getTool();
    const result = await tool!.execute({ searches: [{ query: 'test' }] });

    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Brave API key is missing');

    // Restore
    if (originalKey) process.env.BRAVE_API_KEY = originalKey;
  });

  test('should return error when no searches provided', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key';

    const tool = getTool();
    const result = await tool!.execute({});

    expect(result).toHaveProperty('error');
    expect(result.error).toContain('No searches provided');

    if (originalKey) process.env.BRAVE_API_KEY = originalKey;
    else delete process.env.BRAVE_API_KEY;
  });

  test('should call Brave API and return formatted results', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key';

    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = async (url: any, options: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      expect(urlStr).toContain('api.search.brave.com/res/v1/images/search');
      expect(urlStr).toContain('q=golden+gate+bridge');
      expect(options.headers['X-Subscription-Token']).toBe('test-key');

      return new Response(JSON.stringify(MOCK_BRAVE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const tool = getTool();
    const result = await tool!.execute({ searches: [{ query: 'golden gate bridge', count: 3 }] });

    expect(result).not.toHaveProperty('error');
    expect(result.results).toHaveLength(1);

    const firstSearch = result.results[0];
    expect(firstSearch.query).toBe('golden gate bridge');
    expect(firstSearch.results).toHaveLength(3);

    const first = firstSearch.results[0];
    expect(first.title).toBe('Golden Gate Bridge at Sunset');
    expect(first.thumbnail).toBe('https://imgs.example.com/thumb/gg1.jpg');
    expect(first.pageUrl).toBe('https://example.com/photos/gg-bridge');
    expect(first.image.url).toBe('https://example.com/gg-bridge-full.jpg');

    // Restore
    global.fetch = originalFetch;
    if (originalKey) process.env.BRAVE_API_KEY = originalKey;
    else delete process.env.BRAVE_API_KEY;
  });

  test('should execute multiple searches in parallel', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key';

    const originalFetch = global.fetch;
    const fetchedQueries: string[] = [];
    global.fetch = async (url: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      const match = urlStr.match(/q=([^&]+)/);
      if (match) fetchedQueries.push(decodeURIComponent(match[1].replace(/\+/g, ' ')));

      return new Response(JSON.stringify(MOCK_BRAVE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const tool = getTool();
    const result = await tool!.execute({
      searches: [
        { query: 'golden gate bridge' },
        { query: 'eiffel tower' },
      ]
    });

    expect(result).not.toHaveProperty('error');
    expect(result.results).toHaveLength(2);
    expect(fetchedQueries).toContain('golden gate bridge');
    expect(fetchedQueries).toContain('eiffel tower');
    expect(result.results[0].query).toBe('golden gate bridge');
    expect(result.results[1].query).toBe('eiffel tower');

    global.fetch = originalFetch;
    if (originalKey) process.env.BRAVE_API_KEY = originalKey;
    else delete process.env.BRAVE_API_KEY;
  });

  test('should handle API errors gracefully', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key';

    const originalFetch = global.fetch;
    global.fetch = async () => {
      return new Response('Rate limit exceeded', { status: 429 });
    };

    const tool = getTool();
    const result = await tool!.execute({ searches: [{ query: 'test' }] });

    expect(result).not.toHaveProperty('error');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toHaveProperty('error');
    expect(result.results[0].error).toContain('429');

    global.fetch = originalFetch;
    if (originalKey) process.env.BRAVE_API_KEY = originalKey;
    else delete process.env.BRAVE_API_KEY;
  });

  test('should clamp count between 1 and 20', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key';

    const originalFetch = global.fetch;
    let capturedUrl = '';
    global.fetch = async (url: any) => {
      capturedUrl = typeof url === 'string' ? url : url.toString();
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const tool = getTool();

    // Test count > 20 gets clamped
    await tool!.execute({ searches: [{ query: 'test', count: 50 }] });
    expect(capturedUrl).toContain('count=20');

    // Test count < 1 gets clamped
    await tool!.execute({ searches: [{ query: 'test', count: -5 }] });
    expect(capturedUrl).toContain('count=1');

    global.fetch = originalFetch;
    if (originalKey) process.env.BRAVE_API_KEY = originalKey;
    else delete process.env.BRAVE_API_KEY;
  });
});

// --- parseImageBlocks Unit Tests ---

test.describe('parseImageBlocks - Parser Tests', () => {
  test('should return text-only when no <images> tags present', () => {
    const result = parseImageBlocks('Hello world, no images here.');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    if (result[0].type === 'text') {
      expect(result[0].content).toBe('Hello world, no images here.');
    }
  });

  test('should parse a complete <images> block', () => {
    const content = `Here are some images:

<images>
<image src="https://example.com/1.jpg" title="First Image" link="https://example.com/page1" />
<image src="https://example.com/2.jpg" title="Second Image" link="https://example.com/page2" />
</images>

Hope you like them!`;

    const result = parseImageBlocks(content);
    expect(result).toHaveLength(3);

    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('images');
    expect(result[2].type).toBe('text');

    if (result[1].type === 'images') {
      expect(result[1].images).toHaveLength(2);
      expect(result[1].loading).toBe(false);
      expect(result[1].images[0].src).toBe('https://example.com/1.jpg');
      expect(result[1].images[0].title).toBe('First Image');
      expect(result[1].images[0].link).toBe('https://example.com/page1');
    }
  });

  test('should handle incomplete <images> block during streaming (loading state)', () => {
    const content = `Here are some images:

<images>
<image src="https://example.com/1.jpg" title="First Image" link="https://example.com/page1" />
<image src="https://example.`;

    const result = parseImageBlocks(content);
    expect(result).toHaveLength(2);

    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('images');

    if (result[1].type === 'images') {
      // Should have parsed the one complete image tag
      expect(result[1].images).toHaveLength(1);
      expect(result[1].loading).toBe(true);
      expect(result[1].images[0].title).toBe('First Image');
    }
  });

  test('should show loading with 0 images when <images> just opened', () => {
    const content = 'Here are some images:\n\n<images>\n';

    const result = parseImageBlocks(content);
    expect(result).toHaveLength(2);

    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('images');

    if (result[1].type === 'images') {
      expect(result[1].images).toHaveLength(0);
      expect(result[1].loading).toBe(true);
    }
  });

  test('should handle multiple complete <images> blocks', () => {
    const content = `First batch:
<images>
<image src="https://a.com/1.jpg" title="A1" link="https://a.com" />
</images>

Second batch:
<images>
<image src="https://b.com/1.jpg" title="B1" link="https://b.com" />
<image src="https://b.com/2.jpg" title="B2" link="https://b.com/2" />
</images>`;

    const result = parseImageBlocks(content);
    expect(result).toHaveLength(4);

    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('images');
    expect(result[2].type).toBe('text');
    expect(result[3].type).toBe('images');

    if (result[1].type === 'images') {
      expect(result[1].images).toHaveLength(1);
    }
    if (result[3].type === 'images') {
      expect(result[3].images).toHaveLength(2);
    }
  });
});

// --- UI Rendering Tests ---

test.describe('Image Gallery - UI Rendering', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should render image gallery from message content with <images> tags', async ({ page }) => {
    const user = await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Content that the AI would produce with image results
    const imageContent = `Here are some beautiful images of the Golden Gate Bridge:

<images>
<image src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/1280px-GoldenGateBridge-001.jpg" title="Golden Gate Bridge" link="https://en.wikipedia.org/wiki/Golden_Gate_Bridge" />
<image src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Golden_Gate_Bridge_at_night%2C_2023.jpg/800px-Golden_Gate_Bridge_at_night%2C_2023.jpg" title="Bridge at Night" link="https://en.wikipedia.org/wiki/Golden_Gate_Bridge" />
<image src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/San_Francisco_from_the_Marin_Headlands_in_March_2019.jpg/1280px-San_Francisco_from_the_Marin_Headlands_in_March_2019.jpg" title="SF Panorama" link="https://en.wikipedia.org/wiki/San_Francisco" />
</images>

These photos show the bridge from different angles and times of day.`;

    // Insert a conversation with a message containing <images> tags directly into the DB
    const Database = require('better-sqlite3');
    const path = require('path');
    const { v4: uuidv4 } = require('uuid');
    const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
    const db = new Database(dbPath);

    const convId = uuidv4();
    const now = new Date().toISOString();

    // Create conversation
    db.prepare(`
      INSERT INTO conversations (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(convId, user.id, 'Image Test', now, now);

    // Create user message event
    const insertEvent = db.prepare(`
      INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(uuidv4(), convId, 1, 'user_message',
      JSON.stringify({ text: 'Show me images of the Golden Gate Bridge' }), now);

    // Create assistant message event with <images> tags
    insertEvent.run(uuidv4(), convId, 2, 'assistant_text',
      JSON.stringify({ text: imageContent }), now);

    db.pragma('wal_checkpoint(FULL)');
    db.close();

    // Navigate to the conversation
    await page.goto(`/chat/${convId}`);
    await page.waitForLoadState('networkidle');

    // Wait for assistant message to appear
    const assistantMessage = page.locator('.message.assistant');
    await expect(assistantMessage).toBeVisible({ timeout: 10000 });

    // Verify the image gallery is rendered (not raw text)
    const imageButtons = assistantMessage.locator('button:has(img)');
    await expect(imageButtons.first()).toBeVisible({ timeout: 5000 });
    await expect(imageButtons).toHaveCount(3);

    // Verify image src attributes
    const firstImg = imageButtons.nth(0).locator('img');
    await expect(firstImg).toHaveAttribute('src', /wikimedia/);
    await expect(firstImg).toHaveAttribute('alt', 'Golden Gate Bridge');

    // Verify title text is rendered
    const firstTitle = imageButtons.nth(0).locator('span');
    await expect(firstTitle).toContainText('Golden Gate Bridge');

    // Verify the surrounding text is also rendered (not eaten by the parser)
    await expect(assistantMessage).toContainText('beautiful images');
    await expect(assistantMessage).toContainText('different angles');

    // Verify raw <images> tags are NOT visible as text
    const fullText = await assistantMessage.textContent();
    expect(fullText).not.toContain('<images>');
    expect(fullText).not.toContain('<image src=');
    expect(fullText).not.toContain('</images>');
  });

  test('should open modal when clicking an image and show source link', async ({ page }) => {
    const user = await setupPageWithUser(page);

    const imageContent = `<images>
<image src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/1280px-GoldenGateBridge-001.jpg" title="Golden Gate Bridge" link="https://en.wikipedia.org/wiki/Golden_Gate_Bridge" />
<image src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Golden_Gate_Bridge_at_night%2C_2023.jpg/800px-Golden_Gate_Bridge_at_night%2C_2023.jpg" title="Bridge at Night" link="https://en.wikipedia.org/wiki/Golden_Gate_Bridge" />
</images>`;

    // Seed conversation with image message
    const Database = require('better-sqlite3');
    const path = require('path');
    const { v4: uuidv4 } = require('uuid');
    const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
    const db = new Database(dbPath);

    const convId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO conversations (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(convId, user.id, 'Modal Test', now, now);

    const insertEvent = db.prepare(`
      INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(uuidv4(), convId, 1, 'user_message',
      JSON.stringify({ text: 'Show me bridge photos' }), now);

    insertEvent.run(uuidv4(), convId, 2, 'assistant_text',
      JSON.stringify({ text: imageContent }), now);

    db.pragma('wal_checkpoint(FULL)');
    db.close();

    await page.goto(`/chat/${convId}`);
    await page.waitForLoadState('networkidle');

    // Wait for gallery to render
    const imageButtons = page.locator('.message.assistant button:has(img)');
    await expect(imageButtons.first()).toBeVisible({ timeout: 10000 });

    // Click the first image
    await imageButtons.first().click();

    // Verify modal is visible
    const modalImage = page.locator('div[class*="modal"] img[class*="modalImage"]');
    await expect(modalImage).toBeVisible({ timeout: 3000 });

    // Verify modal shows correct image
    await expect(modalImage).toHaveAttribute('alt', 'Golden Gate Bridge');

    // Verify title in modal header
    const modalTitle = page.locator('span[class*="modalTitle"]');
    await expect(modalTitle).toContainText('Golden Gate Bridge');

    // Verify source link exists in modal
    const sourceLink = page.locator('a[class*="sourceLink"]');
    await expect(sourceLink).toBeVisible();
    await expect(sourceLink).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Golden_Gate_Bridge');
    await expect(sourceLink).toContainText('Source');

    // Verify close button exists
    const closeButton = page.locator('button[class*="closeButton"]');
    await expect(closeButton).toBeVisible();

    // Close the modal
    await closeButton.click();

    // Verify modal is closed
    await expect(modalImage).not.toBeVisible({ timeout: 2000 });
  });

  test('should close modal when clicking overlay background', async ({ page }) => {
    const user = await setupPageWithUser(page);

    const imageContent = `<images>
<image src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/GoldenGateBridge-001.jpg/1280px-GoldenGateBridge-001.jpg" title="Test Image" link="https://example.com" />
</images>`;

    const Database = require('better-sqlite3');
    const path = require('path');
    const { v4: uuidv4 } = require('uuid');
    const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
    const db = new Database(dbPath);

    const convId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO conversations (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(convId, user.id, 'Overlay Test', now, now);

    const insertEvent = db.prepare(`
      INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(uuidv4(), convId, 1, 'user_message',
      JSON.stringify({ text: 'test' }), now);

    insertEvent.run(uuidv4(), convId, 2, 'assistant_text',
      JSON.stringify({ text: imageContent }), now);

    db.pragma('wal_checkpoint(FULL)');
    db.close();

    await page.goto(`/chat/${convId}`);
    await page.waitForLoadState('networkidle');

    // Open modal
    const imageButton = page.locator('.message.assistant button:has(img)').first();
    await expect(imageButton).toBeVisible({ timeout: 10000 });
    await imageButton.click();

    // Verify modal is open
    const modalImage = page.locator('img[class*="modalImage"]');
    await expect(modalImage).toBeVisible({ timeout: 3000 });

    // Click the overlay background (outside the modal) to close
    const overlay = page.locator('div[class*="ImageGallery"][class*="overlay"]');
    await overlay.click({ position: { x: 10, y: 10 } });

    // Verify modal is closed
    await expect(modalImage).not.toBeVisible({ timeout: 2000 });
  });
});

// --- Full Integration Test (real Gemini + real Brave API) ---
// Note: The Brave API call is server-side, so it cannot be mocked from Playwright.
// This test requires real GOOGLE_API_KEY and BRAVE_API_KEY in .env.test.

test.describe('Image Search - Full Integration', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('should use image_search tool and render gallery via Gemini', async ({ page }) => {
    test.setTimeout(90000);

    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select Gemini provider
    const aiProvider = page.locator('#ai-provider');
    await aiProvider.selectOption('gemini');

    // Send a message that explicitly asks for image search
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('Use image_search to find photos of the Eiffel Tower and display them');
    await input.press('Enter');

    // Wait for streaming to complete
    await waitForChatCompletion(page);

    // Verify assistant message appeared
    const assistantMessage = page.locator('.message.assistant').last();
    await expect(assistantMessage).toBeVisible({ timeout: 30000 });

    // Verify image gallery rendered (button elements with img inside)
    const imageButtons = assistantMessage.locator('button:has(img)');
    await expect(imageButtons.first()).toBeVisible({ timeout: 10000 });

    // Should have multiple images
    const count = await imageButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Verify raw <images> tags are NOT visible as text
    const fullText = await assistantMessage.textContent();
    expect(fullText).not.toContain('<images>');
    expect(fullText).not.toContain('<image src=');
  });
});
