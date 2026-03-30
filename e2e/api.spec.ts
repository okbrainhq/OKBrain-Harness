import { test, expect, request } from '@playwright/test'; // Import request to create contexts
import { loadTestEnv, verifyTestDb, createUniqueUser } from './test-utils';

loadTestEnv();

// Run once before all tests in this worker
// Note: With multiple workers, each worker runs beforeAll independently
// Since we use createUniqueUser() per test, we don't need setupTestUser()
test.beforeAll(async () => {
  if (process.env.VERIFY_DB !== 'false') {
    verifyTestDb();
    process.env.VERIFY_DB = 'false';
  }
});

test.describe('API Endpoints', () => {
  test.describe.configure({ mode: 'parallel' });

  // Helper to create authenticated request context
  async function createAuthContext() {
    const user = await createUniqueUser();
    const context = await request.newContext({
      baseURL: 'http://localhost:3001',
      extraHTTPHeaders: {
        'Cookie': `auth-token=${user.token}`,
      },
    });

    // Wait until the server can see the user
    for (let i = 0; i < 20; i++) {
      const meResp = await context.get('/api/auth/me');
      if (meResp.ok()) {
        // Also verify FK works by trying a test conversation
        const testResp = await context.post('/api/conversations', {
          data: { title: '__warmup__' },
        });
        if (testResp.ok()) {
          const testConv = await testResp.json();
          await context.delete(`/api/conversations/${testConv.id}`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return { user, request: context };
  }

  test('should return empty conversations list initially @smoke', async () => {
    const { request } = await createAuthContext();
    const response = await request.get('/api/conversations');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBe(0); // Should be 0 for new unique user
  });

  test('should create a new conversation @smoke', async () => {
    const { request } = await createAuthContext();
    const response = await request.post('/api/conversations', {
      data: { title: 'Test Conversation' },
    });

    expect(response.ok()).toBeTruthy();
    const conversation = await response.json();
    expect(conversation).toHaveProperty('id');
    expect(conversation.title).toBe('Test Conversation');
  });

  test('should get conversation by ID @smoke', async () => {
    const { request } = await createAuthContext();
    // Create conversation first
    const createResponse = await request.post('/api/conversations', {
      data: { title: 'Test Get' },
    });
    const created = await createResponse.json();

    // Get conversation
    const getResponse = await request.get(`/api/conversations/${created.id}`);
    expect(getResponse.ok()).toBeTruthy();

    const conversation = await getResponse.json();
    expect(conversation.id).toBe(created.id);
    expect(conversation.title).toBe('Test Get');
  });

  test('should delete conversation @smoke', async () => {
    const { request } = await createAuthContext();
    // Create conversation
    const createResponse = await request.post('/api/conversations', {
      data: { title: 'Test Delete' },
    });
    const created = await createResponse.json();

    // Delete conversation
    const deleteResponse = await request.delete(`/api/conversations/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();

    // Verify deleted
    const getResponse = await request.get(`/api/conversations/${created.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('should get messages for a conversation @smoke', async () => {
    const { request } = await createAuthContext();
    // Create conversation
    const createResponse = await request.post('/api/conversations', {
      data: { title: 'Test Messages' },
    });
    const created = await createResponse.json();

    // Get messages (should be empty initially)
    const messagesResponse = await request.get(`/api/conversations/${created.id}/messages`);
    expect(messagesResponse.ok()).toBeTruthy();

    const messages = await messagesResponse.json();
    expect(Array.isArray(messages)).toBeTruthy();
  });
});

