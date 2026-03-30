/**
 * Generate JSONL training data for fine-tuning Qwen 3.5b on title generation.
 *
 * Extracts conversation titles and first user messages from the database,
 * using only conversations created BEFORE Qwen was used for title generation
 * (before March 8, 2026 — commit 1bdc809).
 *
 * Usage: npx tsx scripts/ml/generate-title-training-data.ts [db-path]
 * Output: scripts/ml/title-training-data.jsonl
 *
 * This is an OFFLINE operation. Stop the app before running.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const dbPath = process.argv[2] || path.join(process.cwd(), 'brain.db');
const outputPath = path.join(process.cwd(), 'scripts', 'ml', 'title-training-data.jsonl');

console.log(`[TrainingData] Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Qwen title generation was added on March 8, 2026 20:32:51 IST (+0530)
// Convert to UTC: 2026-03-08T15:02:51Z
const QWEN_CUTOFF = '2026-03-08T15:02:51';

// Same prompt used in src/lib/ai/title.ts
const TITLE_PROMPT = `Generate a short title (3-5 words) for a conversation based on the user message and assistant response below.

Rules:
- Return ONLY the title, nothing else
- NO markdown, NO quotes, NO bold, NO explanations
- Keep numbers and technical terms as-is (e.g. "5090" stays "5090", not spelled out)
- Do NOT include dates in the title
- Focus on the core topic of the conversation

Examples:
- "How do I cook pasta?" → "Cooking Pasta"
- "Find about 5090 for ML training" → "5090 for ML Training"
- "What's the weather like today?" → "Weather Today"

User Message:`;

function getFirstUserMessage(conversationId: string): string | null {
  // Try chat_events first
  const event = db.prepare(`
    SELECT content FROM chat_events
    WHERE conversation_id = ? AND kind = 'user_message'
    ORDER BY seq ASC LIMIT 1
  `).get(conversationId) as { content: string } | undefined;

  if (event) {
    try {
      return JSON.parse(event.content).text || null;
    } catch {}
  }

  // Fall back to messages table
  const msg = db.prepare(`
    SELECT content FROM messages
    WHERE conversation_id = ? AND role = 'user'
    ORDER BY created_at ASC LIMIT 1
  `).get(conversationId) as { content: string } | undefined;

  return msg?.content || null;
}

function getFirstAssistantResponse(conversationId: string): string | null {
  // Try chat_events first
  const event = db.prepare(`
    SELECT content FROM chat_events
    WHERE conversation_id = ? AND kind = 'assistant_message'
    ORDER BY seq ASC LIMIT 1
  `).get(conversationId) as { content: string } | undefined;

  if (event) {
    try {
      return JSON.parse(event.content).text || null;
    } catch {}
  }

  // Fall back to messages table
  const msg = db.prepare(`
    SELECT content FROM messages
    WHERE conversation_id = ? AND role = 'assistant'
    ORDER BY created_at ASC LIMIT 1
  `).get(conversationId) as { content: string } | undefined;

  return msg?.content || null;
}

try {
  // Get conversations created before Qwen was used for titles
  const conversations = db.prepare(`
    SELECT id, title, created_at
    FROM conversations
    WHERE created_at < ?
      AND title != 'New Chat'
      AND title IS NOT NULL
      AND title != ''
    ORDER BY created_at ASC
  `).all(QWEN_CUTOFF) as Array<{ id: string; title: string; created_at: string }>;

  console.log(`[TrainingData] Found ${conversations.length} conversations before Qwen cutoff (${QWEN_CUTOFF})`);

  let count = 0;
  let skipped = 0;
  const lines: string[] = [];

  for (const conv of conversations) {
    const firstMessage = getFirstUserMessage(conv.id);
    if (!firstMessage) {
      skipped++;
      continue;
    }

    const assistantResponse = getFirstAssistantResponse(conv.id);
    const responsePart = assistantResponse
      ? `\n\nAssistant Response (first 300 chars):\n"${assistantResponse.slice(0, 300)}"`
      : '';

    const input = `${TITLE_PROMPT}\n"${firstMessage}"${responsePart}`;

    const entry = {
      input,
      output: conv.title,
    };

    lines.push(JSON.stringify(entry));
    count++;
  }

  fs.writeFileSync(outputPath, lines.join('\n') + '\n');
  console.log(`[TrainingData] Wrote ${count} training examples to ${outputPath}`);
  console.log(`[TrainingData] Skipped ${skipped} conversations (no first message)`);
} finally {
  db.close();
}
