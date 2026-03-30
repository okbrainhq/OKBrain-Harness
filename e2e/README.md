# E2E Testing Guide

## Setup

1. **Create `.env.test` file** (copy from `.env.test.example`):
```bash
cp .env.test.example .env.test
```

2. **Add your test API key** to `.env.test`:
```bash
GOOGLE_API_KEY=your_test_api_key_here
```

## Running Tests

```bash
# Run all tests headless
npm run test:e2e

# Run tests with Playwright UI (recommended for debugging)
npm run test:e2e:ui

# Run tests in headed mode (see browser)
npm run test:e2e:headed
```

## Test Database

Tests use a separate database (`brain.test.db`) that is automatically cleaned before each test. Your production database (`brain.db`) is never touched during testing.

## Test Files

- `chat.spec.ts` - UI tests for chat functionality
- `api.spec.ts` - API endpoint tests
- `test-utils.ts` - Shared test utilities

## Test Coverage

### Chat UI Tests
- ✅ Home page loads correctly
- ✅ Create new chat and send message
- ✅ Sidebar collapse/expand
- ✅ Google Grounding toggle and persistence
- ✅ Chat history display
- ✅ Delete conversation with confirmation
- ✅ Load existing conversation
- ✅ Empty input handling

### API Tests
- ✅ Get conversations list
- ✅ Create conversation
- ✅ Get conversation by ID
- ✅ Delete conversation
- ✅ Get messages for conversation

## Troubleshooting

If tests fail:
1. Make sure `.env.test` exists with a valid API key
2. Check that the dev server starts successfully
3. Increase timeouts in test files if API calls are slow
4. Run with `--headed` flag to see what's happening

