/**
 * Context Compaction Summary Generator
 *
 * Generates a concise summary of conversation history for context compaction.
 * Tries Gemini first, falls back to Grok via xAI's OpenAI-compatible API.
 */

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logGeminiUsage } from "./adapters/gemini-adapter";
import { registry } from "./registry";

const COMPACTION_PROMPT = `You are a context compaction engine. Your job is to produce a concise summary of the conversation history that preserves all information needed for the AI to continue its work.

Your summary MUST preserve:
1. **Key facts and decisions** — any conclusions reached, preferences stated, or constraints identified
2. **Tool call results** — what tools were called, what they returned, and the outcomes
3. **Current task state** — what has been accomplished so far
4. **Next steps** — what the AI was about to do or was working toward
5. **File paths, code snippets, and specific details** — anything the AI would need to reference

Your summary MUST NOT:
- Include conversational filler or pleasantries
- Repeat the system prompt instructions
- Include the full text of tool outputs (summarize the key findings)

Format as a structured summary with clear sections. Be concise but comprehensive — missing a critical detail could derail the AI's work.`;

async function summarizeWithGemini(conversationText: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  const modelName = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  const prompt = `${COMPACTION_PROMPT}\n\n---\n\nCONVERSATION HISTORY TO SUMMARIZE:\n\n${conversationText}`;

  let fullResponse = "";
  let lastUsageMetadata: any = null;

  const stream = await client.models.generateContentStream({
    model: modelName,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
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
    logGeminiUsage("Compaction", lastUsageMetadata, modelName, pricing);
  }

  return fullResponse;
}

async function summarizeWithGrok(conversationText: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not set");

  const prompt = `${COMPACTION_PROMPT}\n\n---\n\nCONVERSATION HISTORY TO SUMMARIZE:\n\n${conversationText}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-3-mini-fast",
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grok compaction failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function messagesToText(messages: any[]): string {
  return messages.map(msg => {
    const role = msg.role || "unknown";
    const content = typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);
    return `[${role}]: ${content}`;
  }).join("\n\n");
}

/**
 * Generate a compaction summary from conversation messages.
 * Tries Gemini first, falls back to Grok. Returns empty string if both fail.
 */
export async function generateCompactionSummary(messages: any[]): Promise<string> {
  const conversationText = messagesToText(messages);

  // Try Gemini first
  if (process.env.GOOGLE_API_KEY) {
    try {
      return await summarizeWithGemini(conversationText);
    } catch (error) {
      console.warn("[Compaction] Gemini failed, trying Grok fallback:", error);
    }
  }

  // Fallback to Grok
  if (process.env.XAI_API_KEY) {
    try {
      return await summarizeWithGrok(conversationText);
    } catch (error) {
      console.warn("[Compaction] Grok fallback also failed:", error);
    }
  }

  // Neither available
  console.warn("[Compaction] No compaction provider available (GOOGLE_API_KEY and XAI_API_KEY both missing or failed)");
  return "";
}
