import { test, expect } from '@playwright/test';
import { loadTestEnv } from './test-utils';
import { runWithToolContext } from '../src/lib/ai/tools/context';
import { v4 as uuidv4 } from 'uuid';
import { createUser, createConversation, addChatEvent, addFact, saveFactSheet } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { searchFactsTools } from '../src/lib/ai/tools/search-facts';
import { searchConversationsTools } from '../src/lib/ai/tools/search-conversations';
import { searchConversationTools } from '../src/lib/ai/tools/search-conversation';

loadTestEnv();

let testUserId: string;

test.beforeAll(async () => {
  testUserId = uuidv4();
  const email = `test-search-${testUserId}@example.com`;
  const hashedPassword = await hashPassword('password123');
  await createUser(testUserId, email, hashedPassword);
});

const executeWithContext = async (tool: any, args: any): Promise<any> => {
  return runWithToolContext({ userId: testUserId }, () => tool.execute(args));
};

const getSearchFactsTool = () => searchFactsTools.find(t => t.definition.name === 'search_facts')!;
const getSearchConversationsTool = () => searchConversationsTools.find(t => t.definition.name === 'search_conversations')!;
const getSearchConversationTool = () => searchConversationTools.find(t => t.definition.name === 'search_conversation')!;

// Helper to seed facts
async function seedFacts() {
  await addFact(testUserId, uuidv4(), 'technical', 'Brain uses SQLite for storage');
  await addFact(testUserId, uuidv4(), 'core', 'Arunoda likes TypeScript');
  await addFact(testUserId, uuidv4(), 'project', 'Deploy target is a Linux VM');
  await addFact(testUserId, uuidv4(), 'transient', 'Currently debugging SQLite performance');
}

// Helper to seed a conversation with messages
async function seedConversation(title: string, messages: { role: 'user' | 'assistant'; text: string }[]) {
  const convId = uuidv4();
  await createConversation(testUserId, convId, title);
  for (const msg of messages) {
    const kind = msg.role === 'user' ? 'user_message' : 'assistant_text';
    await addChatEvent(convId, kind, { text: msg.text });
  }
  return convId;
}

test.describe('search_facts', () => {
  test.describe.configure({ mode: 'serial' });

  test('setup: seed facts', async () => {
    await seedFacts();
  });

  test('finds facts matching keyword', async () => {
    const result = await executeWithContext(getSearchFactsTool(), { query: 'SQLite' });
    expect(result).toContain('SQLite');
    expect(result).toContain('Found 2 fact');
  });

  test('filters by category', async () => {
    const result = await executeWithContext(getSearchFactsTool(), { query: 'SQLite', category: 'technical' });
    expect(result).toContain('Found 1 fact');
    expect(result).toContain('technical');
  });

  test('respects limit', async () => {
    const result = await executeWithContext(getSearchFactsTool(), { query: 'SQLite', limit: 1 });
    expect(result).toContain('Found 1 fact');
  });

  test('multi-word query matches any word (OR logic)', async () => {
    // "TypeScript deploy" should match both "Arunoda likes TypeScript" and "Deploy target is a Linux VM"
    const result = await executeWithContext(getSearchFactsTool(), { query: 'TypeScript deploy' });
    expect(result).toContain('TypeScript');
    expect(result).toContain('Deploy');
    expect(result).toContain('Found 2 fact');
  });

  test('exact phrase matches appear before word matches', async () => {
    // "SQLite for storage" is an exact phrase in "Brain uses SQLite for storage"
    // "SQLite performance" only word-matches "Currently debugging SQLite performance" (exact) and "Brain uses SQLite for storage" (word: SQLite)
    const result = await executeWithContext(getSearchFactsTool(), { query: 'SQLite for storage', limit: 1 });
    // With limit=1, the exact phrase match should win
    expect(result).toContain('Brain uses SQLite for storage');
  });

  test('returns empty message when no matches', async () => {
    const result = await executeWithContext(getSearchFactsTool(), { query: 'quantum computing' });
    expect(result).toContain('No facts found');
  });
});

test.describe('search_conversations', () => {
  test.describe.configure({ mode: 'serial' });

  let deployConvId: string;

  test('setup: seed conversations', async () => {
    deployConvId = await seedConversation('Deployment Strategy Discussion', [
      { role: 'user', text: 'How should we deploy?' },
      { role: 'assistant', text: 'I recommend using Docker containers.' },
    ]);
    await seedConversation('Recipe for Pasta', [
      { role: 'user', text: 'How do I make pasta?' },
      { role: 'assistant', text: 'Boil water, add pasta, cook for 10 minutes.' },
    ]);
  });

  test('finds conversations by title', async () => {
    const result = await executeWithContext(getSearchConversationsTool(), { query: 'Deployment' });
    expect(result).toContain('Deployment Strategy Discussion');
    expect(result).toContain(deployConvId);
    expect(result).not.toContain('Pasta');
  });

  test('respects limit', async () => {
    // Search broadly — both conversations have content
    await seedConversation('Deployment Checklist', [
      { role: 'user', text: 'What is the checklist?' },
    ]);
    const result = await executeWithContext(getSearchConversationsTool(), { query: 'Deployment', limit: 1 });
    expect(result).toContain('Found 1 conversation');
  });

  test('whole-word matches rank above substring matches', async () => {
    // "NAS" should match "Easy NAS Setup" as whole word but "Rathanasiri" only as substring
    await seedConversation('Easy NAS Setup', [
      { role: 'user', text: 'Setting up NAS' },
    ]);
    await seedConversation('Requesting Rathanasiri', [
      { role: 'user', text: 'Contact Rathanasiri' },
    ]);
    const result = await executeWithContext(getSearchConversationsTool(), { query: 'NAS' });
    expect(result).toContain('Easy NAS Setup');
    expect(result).toContain('Rathanasiri');
    // "Easy NAS Setup" should appear before "Rathanasiri" in the output
    const nasPos = result.indexOf('Easy NAS Setup');
    const rathPos = result.indexOf('Rathanasiri');
    expect(nasPos).toBeLessThan(rathPos);
  });

  test('returns empty message when no matches', async () => {
    const result = await executeWithContext(getSearchConversationsTool(), { query: 'quantum physics' });
    expect(result).toContain('No conversations found');
  });
});

test.describe('search_conversation', () => {
  test.describe.configure({ mode: 'serial' });

  let convId: string;

  test('setup: seed conversation with many messages', async () => {
    convId = await seedConversation('Server Configuration Chat', [
      { role: 'user', text: 'Let me set up the server.' },
      { role: 'assistant', text: 'Sure, what configuration do you need?' },
      { role: 'user', text: 'What port should the server run on?' },
      { role: 'assistant', text: 'I recommend using port 4567 for staging.' },
      { role: 'user', text: 'Sounds good. What about the database?' },
      { role: 'assistant', text: 'Use PostgreSQL on port 5432.' },
      { role: 'user', text: 'And the cache layer?' },
      { role: 'assistant', text: 'Redis on port 6379 is the standard choice.' },
      { role: 'user', text: 'What about monitoring?' },
      { role: 'assistant', text: 'Grafana on port 3000 for dashboards.' },
    ]);
  });

  test('finds matching text with context', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: '4567',
    });
    expect(result).toContain('4567');
    expect(result).toContain('← match');
    expect(result).toContain('Server Configuration Chat');
    // Default context_before=1 should include the message before
    expect(result).toContain('What port should the server run on?');
    // Default context_after=1 should include the message after
    expect(result).toContain('Sounds good');
  });

  test('context_before=0 excludes messages before match', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: '4567',
      context_before: 0,
      context_after: 0,
    });
    expect(result).toContain('4567');
    expect(result).not.toContain('What port should the server run on?');
    expect(result).not.toContain('Sounds good');
  });

  test('context_after=3 includes more messages after match', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: '4567',
      context_before: 0,
      context_after: 3,
    });
    expect(result).toContain('4567');
    expect(result).toContain('Sounds good');
    expect(result).toContain('PostgreSQL');
    expect(result).toContain('cache layer');
  });

  test('finds multiple matches', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: 'port',
      max_matches: 5,
      context_before: 0,
      context_after: 0,
    });
    // "port" appears in 5 messages: the question + 4 answers
    expect(result).toContain('5 matches');
  });

  test('max_matches caps results', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: 'port',
      max_matches: 2,
      context_before: 0,
      context_after: 0,
    });
    expect(result).toContain('5 matches');
    expect(result).toContain('showing first 2');
  });

  test('exact phrase matches get priority over word matches', async () => {
    // "port 4567" is an exact phrase in one message, but "port" alone matches 5 messages
    // With max_matches=1, the exact phrase match should be selected
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: 'port 4567',
      max_matches: 1,
      context_before: 0,
      context_after: 0,
    });
    expect(result).toContain('port 4567');
    expect(result).toContain('← match');
    // Should not include word-only matches like "What port should the server run on?"
    expect(result).not.toContain('What port should the server run on?');
  });

  test('returns error for non-existent conversation', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: 'non-existent-id',
      query: 'test',
    });
    expect(result).toContain('not found');
  });

  test('returns empty message when no matches in conversation', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: 'quantum computing',
    });
    expect(result).toContain('No matches found');
  });

  test('includes timestamps in output', async () => {
    const result = await executeWithContext(getSearchConversationTool(), {
      conversation_id: convId,
      query: '4567',
      context_before: 0,
      context_after: 0,
    });
    // Should have format [role, YYYY-MM-DD HH:MM]
    expect(result).toMatch(/\[assistant, \d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/);
  });
});

test.describe('recent message gap coverage', () => {
  test.describe.configure({ mode: 'serial' });

  let gapUserId: string;

  test('setup: create user with fact sheet and recent messages', async () => {
    gapUserId = uuidv4();
    const email = `test-gap-${gapUserId}@example.com`;
    const hashedPassword = await hashPassword('password123');
    await createUser(gapUserId, email, hashedPassword);

    // Add some facts (simulating already-extracted content)
    await addFact(gapUserId, uuidv4(), 'technical', 'Uses Redis for caching');

    // Save a fact sheet — created_at defaults to CURRENT_TIMESTAMP
    await saveFactSheet(uuidv4(), gapUserId, '[]', null, 0, 'qwen');

    // Wait so messages get a later CURRENT_TIMESTAMP (second precision)
    await new Promise(r => setTimeout(r, 1100));

    // Now add conversations AFTER the fact sheet (the "dark time" gap)
    const convId = uuidv4();
    await createConversation(gapUserId, convId, 'Recent Kubernetes Chat');
    await addChatEvent(convId, 'user_message', { text: 'I want to set up Kubernetes on my cluster' });
    await addChatEvent(convId, 'assistant_text', { text: 'Sure, you can use kubeadm to bootstrap the cluster.' });

    const convId2 = uuidv4();
    await createConversation(gapUserId, convId2, 'Unrelated Chat');
    await addChatEvent(convId2, 'user_message', { text: 'What is the weather today?' });
    await addChatEvent(convId2, 'assistant_text', { text: 'It is sunny and warm.' });
  });

  const executeGapContext = async (tool: any, args: any): Promise<any> => {
    return runWithToolContext({ userId: gapUserId }, () => tool.execute(args));
  };

  test('search_facts includes recent user messages from gap period', async () => {
    const result = await executeGapContext(getSearchFactsTool(), { query: 'Kubernetes' });
    // No extracted facts match, but the recent user message should
    expect(result).toContain('Recent mentions (not yet extracted)');
    expect(result).toContain('Kubernetes');
    expect(result).toContain('Recent Kubernetes Chat');
  });

  test('search_facts recent mentions include timestamps', async () => {
    const result = await executeGapContext(getSearchFactsTool(), { query: 'Kubernetes' });
    // Recent mentions should have format YYYY-MM-DD HH:MM
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  test('search_facts recent mentions only include user messages', async () => {
    const result = await executeGapContext(getSearchFactsTool(), { query: 'kubeadm' });
    // "kubeadm" is only in the assistant message, should not appear in facts search
    expect(result).toContain('No facts found');
  });

  test('search_conversations finds recent conversations by message content', async () => {
    const result = await executeGapContext(getSearchConversationsTool(), { query: 'Kubernetes' });
    // Title matches too, but message content search also covers this
    expect(result).toContain('Recent Kubernetes Chat');
  });

  test('search_conversations finds conversations by assistant message in gap', async () => {
    const result = await executeGapContext(getSearchConversationsTool(), { query: 'kubeadm' });
    // "kubeadm" is only in the assistant message — title doesn't match, no linked facts
    // Should be found via recent message search
    expect(result).toContain('Recent Kubernetes Chat');
  });

  test('search_conversations does not duplicate conversations found by both methods', async () => {
    // "Kubernetes" matches by title AND by recent message content
    const result = await executeGapContext(getSearchConversationsTool(), { query: 'Kubernetes' });
    // Should only appear once
    const matches = result.split('Recent Kubernetes Chat').length - 1;
    expect(matches).toBe(1);
  });

  test('search_facts shows both extracted facts and recent mentions', async () => {
    // "Redis" is an extracted fact, seed a recent message mentioning Redis too
    const convId = uuidv4();
    await createConversation(gapUserId, convId, 'Redis Performance Chat');
    await addChatEvent(convId, 'user_message', { text: 'Redis is getting slow on production' });

    const result = await executeGapContext(getSearchFactsTool(), { query: 'Redis' });
    // Should have extracted facts section
    expect(result).toContain('Found 1 fact');
    expect(result).toContain('Uses Redis for caching');
    // And recent mentions section
    expect(result).toContain('Recent mentions (not yet extracted)');
    expect(result).toContain('Redis is getting slow');
  });
});
