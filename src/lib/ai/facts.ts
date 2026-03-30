import { GoogleGenAI, Content, ThinkingLevel } from "@google/genai";
import {
  getConversation,
  getChatEventsByKind,
} from "@/lib/db";
import { logGeminiUsage } from "./adapters/gemini-adapter";
import { registry } from "./registry";
import { callOllama } from "./ollama-api";

export const FACT_CATEGORIES = ["core", "technical", "project", "transient"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export interface ExtractedFact {
  category: FactCategory;
  fact: string;
}

const OLLAMA_EXTRACTION_MODEL = "qwen3.5:4b";

const EXTRACT_FACTS_PROMPT = `
You are a high-precision Memory Extraction Engine for a personal AI assistant. Your goal is to analyze the provided chat history and extract **atomic, long-term facts** about the user.

### 1. CATEGORIZATION RULES
Assign every extracted fact to exactly one of these categories (based on decay logic):
- **core**: Identity, family, personality, long-term beliefs. (No decay)
- **technical**: Programming languages, tech stack, hardware preferences. (Slow decay)
- **project**: Active work, specific apps/features being built. (Standard decay)
- **transient**: News tracking, short-term interests, shopping research. (Fast decay)

### 2. EXTRACTION LOGIC
- **One Concept Per Fact**: Each fact must capture exactly ONE topic, preference, or interest. NEVER combine multiple subjects into a single fact, even if they appear in the same message. For example, "Tracks NVIDIA Rubin and OpenClaw project" is BAD — split into "Tracks NVIDIA Rubin hardware roadmap" and "Follows OpenClaw project updates".
- **Atomic & Concise**: Each fact must be a single, standalone statement under 15 words.
- **Third-Person, No "User" Prefix**: Phrase facts objectively without starting with "User is" or "User". For example, write "Prefers SQLite over Postgres" instead of "User prefers SQLite over Postgres".
- **Direct Facts**: Focus on the core intent or preference. State the topic of interest directly. Avoid indirect phrasing like "User is researching...", "User is inquiring about...", or "User asked about...". For example, instead of "User is researching ThinkPad X2", write "User is interested in the ThinkPad X2".
- **No Noise**: Ignore greetings, small talk, generic requests (e.g., "give me today's news", "summarize this article"), and action commands (e.g., "add an event", "set a reminder"). Do not extract facts from prompt templates or instructions the user gives to the assistant. However, if the user asks about a specific topic repeatedly or with clear personal interest (e.g., "What's the latest on the ThinkPad X2?"), that may indicate genuine interest worth capturing.
- **High Bar**: When in doubt, do NOT extract. Only extract facts you are highly confident reflect a genuine, lasting user trait, preference, or interest. A single casual question is not enough.
- **No Duplicates Among New Facts**: Do not extract multiple new facts that are semantically identical to each other. If two mentions refer to the same single topic, keep one. But do NOT merge distinct topics into one fact.
- **Respect Negations**: Do not attribute a technology or preference to the user if they explicitly state they "don't need," "dislike," or are "just asking about" it.
- **Query vs. Preference**: Only extract "technical" facts if the user confirms usage. A question like "How does Rust work?" is NOT a preference. "I use Rust for my backend" IS a preference.
- **STRICT: User Messages Only**: ONLY extract facts from the user's own messages. Assistant messages are provided ONLY to help you understand what the user was talking about and to correct spelling or grammar in the user's messages. Do NOT derive, infer, or extract any facts from assistant responses. If the assistant mentions a technology, topic, or detail, that is NOT a user fact. Only the user's own words count.
- If there are no meaningful facts, return an empty array.
`.trim();

// Cloud metadata endpoints that must never be contacted
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'metadata.internal']);

function validateOllamaUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    if (BLOCKED_HOSTS.has(parsed.hostname)) {
      throw new Error(`Blocked SSRF target: ${parsed.hostname}`);
    }
    return raw.replace(/\/+$/, '');
  } catch (e: any) {
    console.error(`[FactExtraction] Invalid OLLAMA_URL "${raw}": ${e.message}`);
    return 'http://localhost:11434';
  }
}

async function getExtractionModel(): Promise<"ollama" | "gemini"> {
  try {
    const baseUrl = validateOllamaUrl(process.env.OLLAMA_URL ?? "http://localhost:11434");
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return "gemini";

    const data = await res.json();
    const models = (data.models || []).map((model: any) => model.name);
    if (models.some((name: string) => name === OLLAMA_EXTRACTION_MODEL || name.startsWith(`${OLLAMA_EXTRACTION_MODEL}:`))) {
      return "ollama";
    }

    console.log(`[FactExtraction] ${OLLAMA_EXTRACTION_MODEL} not found on Ollama, falling back to Gemini`);
    return "gemini";
  } catch {
    return "gemini";
  }
}

function buildOllamaPrompt(): string {
  return `Extract facts about the user from the conversation above. Only use the user's own messages.

Categories:
- core: identity, family, location, personality
- technical: tech stack, programming languages, tools
- project: active work, apps being built
- transient: topics the user is interested in or tracking

Rules:
- One fact per item, under 15 words, third-person
- core/technical/project: only extract clear statements (e.g., "Lives in Colombo", "Uses Rust for backend")
- transient: extract when user discusses or asks about a specific topic — phrase as "Interested in [topic]" or "Tracking [topic]"
- Skip greetings and generic commands ("summarize this", "what time is it")
- If no meaningful facts, return []

Respond with ONLY a JSON array. No markdown, no explanation.
Examples:
- User says "I live in Sri Lanka" → [{"category":"core","fact":"Lives in Sri Lanka"}]
- User asks about CEB strike → [{"category":"transient","fact":"Tracking CEB restructuring in Sri Lanka"}]
- User asks about Dubai → [{"category":"transient","fact":"Interested in Dubai's future"}]
- User says "hello" → []`;
}

function buildGeminiPrompt(): string {
  return `${EXTRACT_FACTS_PROMPT}

### 3. OUTPUT FORMAT
Respond with ONLY a valid JSON array of objects. No markdown, no explanation.
Each object must have "category" (one of: core, technical, project, transient) and "fact" (string).

Example:
[{"category":"core","fact":"Lives in Sri Lanka"},{"category":"technical","fact":"Prefers SQLite with better-sqlite3 for local databases"},{"category":"project","fact":"Building a personal AI chat app called Brain using Next.js"}]`;
}

export async function extractFactsSimpleForUser(
  userId: string,
  conversationId: string
): Promise<ExtractedFact[]> {
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return extractFromConversationMessages(
    conversationId,
    conversation.last_fact_extracted_at ?? null
  );
}

async function extractFromConversationMessages(
  conversationId: string,
  lastExtractedAt: string | null
): Promise<ExtractedFact[]> {
  const userEvents = await getChatEventsByKind(conversationId, "user_message", lastExtractedAt || undefined);
  const assistantEvents = await getChatEventsByKind(conversationId, "assistant_text", lastExtractedAt || undefined);

  const allEvents = [...userEvents, ...assistantEvents].sort((a, b) => a.seq - b.seq);
  const filteredMessages = allEvents.map((event) => {
    let content: any;
    try {
      content = JSON.parse(event.content);
    } catch {
      content = event.content;
    }

    const role = event.kind === "user_message" ? "user" : "assistant";
    const text = content.text || "";
    return {
      role,
      content: role === "assistant" ? truncateToWords(text, 50) : text,
    };
  });

  if (filteredMessages.length === 0) {
    return [];
  }

  const model = await getExtractionModel();

  if (model === "ollama") {
    const ollamaPrompt = buildOllamaPrompt();

    let fullResponse = await extractWithOllama(filteredMessages, ollamaPrompt);
    let parsed = parseFactsResponse(fullResponse);
    if (parsed.length > 0) {
      return parsed;
    }

    console.log("[FactExtraction] Ollama returned 0 facts, retrying...");
    fullResponse = await extractWithOllama(filteredMessages, ollamaPrompt);
    parsed = parseFactsResponse(fullResponse);
    if (parsed.length > 0) {
      return parsed;
    }

    console.log("[FactExtraction] Ollama retry returned 0 facts, falling back to Gemini");
  }

  const geminiPrompt = buildGeminiPrompt();
  const fullResponse = await extractWithGemini(filteredMessages, geminiPrompt);
  return parseFactsResponse(fullResponse);
}

async function extractWithGemini(
  messages: { role: string; content: string }[],
  prompt: string
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set");
  }

  const client = new GoogleGenAI({ apiKey });
  const modelName = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  const contents: Content[] = messages.map((message) => ({
    role: message.role === "user" ? "user" : "model",
    parts: [{ text: message.content }],
  }));

  contents.push({
    role: "user",
    parts: [{ text: prompt }],
  });

  let fullResponse = "";
  let lastUsageMetadata: any = null;

  const stream = await client.models.generateContentStream({
    model: modelName,
    contents,
    config: {
      thinkingConfig: {
        includeThoughts: false,
        thinkingLevel: ThinkingLevel.MINIMAL,
      },
    },
  });

  for await (const chunk of stream) {
    if (chunk.text) {
      fullResponse += chunk.text;
    }
    if (chunk.usageMetadata) {
      lastUsageMetadata = chunk.usageMetadata;
    }
  }

  if (lastUsageMetadata) {
    const pricing = registry.getAllModels().find(m => m.apiModel === modelName)?.pricing;
    logGeminiUsage("FactExtraction", lastUsageMetadata, modelName, pricing);
  }

  return fullResponse;
}

async function extractWithOllama(
  messages: { role: string; content: string }[],
  prompt: string
): Promise<string> {
  const ollamaMessages = [
    { role: "system", content: prompt },
    ...messages.map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    })),
    {
      role: "user",
      content: "Extract facts from the conversation. Include transient facts for topics the user asked about. Respond with ONLY a JSON array.",
    },
  ];

  const result = await callOllama(ollamaMessages, {
    model: OLLAMA_EXTRACTION_MODEL,
    thinking: false,
    samplingPreset: "qwen3.5-non-thinking",
  });

  console.log(`[FactExtraction] Ollama ${OLLAMA_EXTRACTION_MODEL} prompt=${result.promptTokens} output=${result.outputTokens}`);
  return result.text;
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function isValidCategory(category: string): category is FactCategory {
  return FACT_CATEGORIES.includes(category as FactCategory);
}

function parseFactsResponse(response: string): ExtractedFact[] {
  const cleaned = response.trim();

  function parseArray(arr: unknown[]): ExtractedFact[] {
    const results: ExtractedFact[] = [];

    for (const item of arr) {
      if (typeof item !== "object" || item === null) continue;

      const obj = item as Record<string, unknown>;
      const category = obj.category;
      const fact = obj.fact;

      if (typeof category === "string" && typeof fact === "string" && isValidCategory(category)) {
        results.push({ category, fact });
      }
    }

    return results;
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parseArray(parsed);
    }
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parseArray(parsed);
        }
      } catch {
        return [];
      }
    }
  }

  return [];
}
