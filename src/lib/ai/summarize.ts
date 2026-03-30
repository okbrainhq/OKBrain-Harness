import { getAIProvider } from "./index";
import { AIMessage, AIStreamChunk } from "./types";

export const SUMMARY_PROMPT = `
As an impartial observer, please summarize the conversation above.
STRICT RULES:
1. Analyze the interaction between the User and the various AI Assistants.
2. Do NOT take sides; remain completely neutral.
3. Use ONLY the information provided in the chat history. Do NOT inject external knowledge.
4. BE CONCISE: Provide a high-level, brief overview. Do NOT deep-dive into every detail. The user can refer to the chat history for specifics.
5. Focus ONLY on the core discussion.
6. NO INTRODUCTIONS: Do NOT include factual fillers like "The conversation consists of..." or descriptive introductory sentences. Just start with the summary.
7. NO COMPASSION/CONSENSUS SECTIONS: If there are no conflicts, do NOT mention "Consensus", "Assistant Interaction", or the lack of conflicts.
8. NO META-ANALYSIS: Avoid talking about the assistants' performance (e.g., "The first assistant provided...").
9. AGGREGATE VIEWS: If multiple agents added different, unrelated perspectives, simply aggregate the facts/views into a single cohesive response based on the user's focus. If they cannot be related, mention that as a disparity of focus.
10. DISPARITIES: Explicitly state ONLY actual disparities, conflicts, or significant lack of conclusion. If there are none, do NOT mentioned them at all.
11. FORMATTING: Use markdown bullet points, bolding, and sub-headings. Use markdown tables only if essential for data.
12. NO LINKS: Do NOT add any links (inline, reference, or otherwise) in the summary.
13. NO ITALICS: NEVER use markdown italics (e.g., *text* or _text_).
14. NO TITLES: Never add a heading called "Summary", "Summary of the conversation", "Assistant Interaction and Consensus", or similar.
15. NO NEGATIVE CONFIRMATIONS: NEVER write things like "There are no disparities", "No conflicts identified", or "The agents agree". If it's all smooth, just provide the facts.
`.trim();

/**
 * Generates a summary for a conversation.
 * It uses Gemini Flash for summaries.
 */
export async function summarizeConversation(
  messages: { role: string; content: string; model?: string }[],
  onChunk: (chunk: AIStreamChunk) => void | Promise<void>,
  signal?: AbortSignal,
  userId?: string
): Promise<string> {
  const ai = getAIProvider('gemini'); // Always use Gemini 3 Flash for summaries

  // Filter out previous summaries from history to avoid recursion/clutter
  const filteredMessages = messages.filter(m => m.role !== 'summary');

  const aiMessages: AIMessage[] = filteredMessages.map(m => ({
    role: (m.role === 'user' ? 'user' : 'assistant') as "user" | "assistant",
    content: m.content,
    model: m.model,
  }));

  // Add the summary prompt as the final instruction
  aiMessages.push({
    role: "user",
    content: SUMMARY_PROMPT,
  });

  let fullResponse = "";

  await ai.generateStream(
    aiMessages,
    async (chunk) => {
      if (chunk.text) {
        fullResponse += chunk.text;
      }
      await onChunk(chunk);
    },
    { signal, userId }
  );

  return fullResponse;
}
