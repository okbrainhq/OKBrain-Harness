import { generateChatTitle } from './utils';
import { callOllama, checkOllamaModelExists } from './ollama-api';

const TITLE_MODEL = 'qwen3.5:4b';

/**
 * Generates a concise conversation title from the first user message.
 * Uses the local Ollama 2B model when available, otherwise falls back to Gemini.
 */
export async function generateTitle(firstMessage: string, assistantResponse?: string): Promise<string> {
  const baseURL = process.env.OLLAMA_URL;
  if (!baseURL) {
    console.log(`[Title] No OLLAMA_URL set, falling back to Gemini`);
    return generateChatTitle(firstMessage, assistantResponse);
  }
  const modelExists = await checkOllamaModelExists(baseURL, TITLE_MODEL);
  if (!modelExists) {
    console.log(`[Title] Model ${TITLE_MODEL} not found on ${baseURL}, falling back to Gemini`);
    return generateChatTitle(firstMessage, assistantResponse);
  }
  return generateTitleWithOllama(baseURL, firstMessage, assistantResponse);
}

async function generateTitleWithOllama(baseURL: string, firstMessage: string, assistantResponse?: string): Promise<string> {
  const responsePart = assistantResponse
    ? `\n\nAssistant Response (first 300 chars):\n"${assistantResponse.slice(0, 300)}"`
    : '';

  const prompt = `Generate a short title (3-5 words) for a conversation based on the user message and assistant response below.

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

User Message:
"${firstMessage}"${responsePart}`;

  try {
    const result = await callOllama(
      [{ role: 'user', content: prompt }],
      { model: TITLE_MODEL, thinking: false }
    );
    console.log(`[Ollama Title] model=${TITLE_MODEL} prompt=${result.promptTokens} output=${result.outputTokens}`);
    return result.text
      .replace(/^["']|["']$/g, '')
      .replace(/[*_#`]/g, '')
      .slice(0, 50)
      || 'New Chat';
  } catch (error) {
    console.error('[Ollama] generateTitle failed:', error);
    return generateChatTitle(firstMessage);
  }
}
