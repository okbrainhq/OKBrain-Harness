/**
 * Exponential backoff with jitter.
 * Attempt 0 -> ~1s, attempt 1 -> ~2s, etc.
 */
export function getRetryDelay(attempt: number): number {
  const baseDelay = Math.pow(2, attempt) * 1000;
  const jitter = baseDelay * 0.2 * Math.random();
  return baseDelay + jitter;
}

/**
 * Fetch with retry and exponential backoff.
 * Retries on 408, 429, 529, 5xx, and common network errors.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok) return response;

      const isRetryableStatus =
        response.status === 408 ||
        response.status === 429 ||
        response.status === 529 ||
        response.status >= 500;

      if (!isRetryableStatus || attempt >= maxRetries) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const retryAfter = response.headers.get('retry-after');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : getRetryDelay(attempt);
      console.log(`[fetchWithRetry] Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms (HTTP ${response.status})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error: any) {
      lastError = error;

      if (error.name === 'AbortError') throw error;

      const isRetryable =
        error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        error.message?.includes('fetch failed') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT');

      if (!isRetryable || attempt >= maxRetries) throw error;

      const delayMs = getRetryDelay(attempt);
      console.log(`[fetchWithRetry] Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
