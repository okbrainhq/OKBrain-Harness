import { GoogleGenAI } from "@google/genai";

/**
 * Cleans the assistant's response by removing redundant self-prefixes.
 */
export function cleanAssistantPrefix(text: string, modelName: string): string {
  if (!text) return text;

  // Escape special characters for regex
  const escapedModelName = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Patterns to match at the start:
  // 1. [Model Name]: 
  // 2. Model Name: 
  // 3. Assistant: 
  // 4. Any of the above with a space before it
  const patterns = [
    new RegExp(`^\\s*\\[${escapedModelName}\\]\\s*:\\s*`, 'i'),
    new RegExp(`^\\s*${escapedModelName}\\s*:\\s*`, 'i'),
    /^\\s*assistant\\s*:\\s*/i,
    /^\\s*bot\\s*:\\s*/i
  ];

  let cleanedText = text;
  let changed = true;

  // Keep cleaning if multiple prefixes were added
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      if (pattern.test(cleanedText)) {
        cleanedText = cleanedText.replace(pattern, '').trim();
        changed = true;
      }
    }
  }

  return cleanedText;
}

/**
 * A helper class to sanitize prefixes from a streaming response.
 * It buffers the beginning of the stream until it can determine if a prefix is present.
 */
export class StreamSanitizer {
  private buffer: string = "";
  private prefixChecked: boolean = false;
  private readonly modelName: string;
  private readonly maxBufferSize: number = 100; // Enough to catch any reasonable prefix

  constructor(modelName: string) {
    this.modelName = modelName;
  }

  /**
   * Processes a new chunk of text. 
   * Returns sanitized text (if any) or an empty string if buffering.
   */
  process(chunk: string): string {
    if (this.prefixChecked) {
      return chunk;
    }

    this.buffer += chunk;

    // If we have "enough" characters or the chunk contains a newline, 
    // we should try to clean and then stop check further.
    // Why newline? Because prefixes are almost always on the first line.
    if (this.buffer.length >= this.maxBufferSize || this.buffer.includes('\n')) {
      return this.checkAndFlush();
    }

    // Still buffering
    return "";
  }

  /**
   * Final flush of the buffer. Should be called at the end of the stream.
   */
  flush(): string {
    if (this.prefixChecked) return "";
    return this.checkAndFlush();
  }

  private checkAndFlush(): string {
    const cleaned = cleanAssistantPrefix(this.buffer, this.modelName);
    this.prefixChecked = true;
    const result = cleaned;
    this.buffer = "";
    return result;
  }
}

/**
 * Generates a concise title for a chat conversation using Gemini.
 */
export async function generateChatTitle(firstMessage: string, assistantResponse?: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn("GOOGLE_API_KEY not found, skipping title generation");
    return "New Chat";
  }

  try {
    const modelName = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
    const ai = new GoogleGenAI({ apiKey });

    const responsePart = assistantResponse
      ? `\n\nAssistant Response (first 300 chars):\n"${assistantResponse.slice(0, 300)}"`
      : '';

    const prompt = `
Generate a short title (3-5 words) for a conversation based on the user message and assistant response below.

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
"${firstMessage}"${responsePart}
    `.trim();

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });

    const usage = response.usageMetadata;
    if (usage) {
      const prompt_tokens = usage.promptTokenCount ?? 0;
      const cached = usage.cachedContentTokenCount ?? 0;
      const output = usage.candidatesTokenCount ?? 0;
      const thinking = usage.thoughtsTokenCount ?? 0;
      const pricing = modelName.includes('pro') ? { input: 2.00, cachedInput: 0.20, output: 12.00 } : { input: 0.50, cachedInput: 0.05, output: 3.00 };
      const inputCost = ((prompt_tokens - cached) * pricing.input + cached * pricing.cachedInput) / 1_000_000;
      const outputCost = (output * pricing.output) / 1_000_000;
      const thinkingCost = (thinking * pricing.output) / 1_000_000;
      const totalCost = inputCost + outputCost + thinkingCost;
      console.log(`[Gemini Title] model=${modelName} prompt=${prompt_tokens} cached=${cached} output=${output} thinking=${thinking} cost=$${totalCost.toFixed(6)} (in=$${inputCost.toFixed(6)} out=$${outputCost.toFixed(6)} think=$${thinkingCost.toFixed(6)})`);
    }

    const title = response.text?.trim() || "New Chat";

    // Clean up and limit title length
    return title
      .replace(/^["']|["']$/g, "") // Remove quotes
      .replace(/[*_#`]/g, "")      // Remove markdown chars
      .slice(0, 50)                // Limit length
      || "New Chat";
  } catch (error) {
    console.error("Failed to generate title with Gemini:", error);
    return "New Chat";
  }
}
