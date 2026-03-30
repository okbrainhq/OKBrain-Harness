/**
 * Citation reminder injected into search tool responses.
 * This ensures the model sees citation instructions right alongside search results,
 * even when the system prompt is cached and the model might forget.
 */
export const SEARCH_CITATION_REMINDER =
  'IMPORTANT: You MUST cite sources inline for every fact from these results. ' +
  'Format: [source](URL) — the word "source" is fixed, do NOT use page titles. ' +
  'Place the period BEFORE the citation. Example: "The sky is blue. [source](https://example.com)" ' +
  'Do NOT create a separate reference/citation list at the end.';

/**
 * Append the citation reminder to a search tool response object.
 */
export function withCitationReminder(response: any): any {
  if (response.error) return response;
  return { ...response, _citation_instructions: SEARCH_CITATION_REMINDER };
}
