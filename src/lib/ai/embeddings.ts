// Embedding configuration functions
export function isEmbeddingsEnabled(): boolean {
  return !!process.env.OLLAMA_URL && !!process.env.VECTOR_EMBEDDING_MODEL;
}

export function getEmbeddingModel(): string {
  const model = process.env.VECTOR_EMBEDDING_MODEL;
  if (!model) throw new Error('VECTOR_EMBEDDING_MODEL not configured');
  return model;
}

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
    console.error(`[Embeddings] Invalid OLLAMA_URL "${raw}": ${e.message}`);
    return 'http://localhost:11434';
  }
}

export function getOllamaUrl(): string | null {
  return process.env.OLLAMA_URL || null;
}

// Initialize constants only when enabled
const OLLAMA_BASE_URL = validateOllamaUrl(getOllamaUrl() ?? 'http://localhost:11434');
const EMBEDDING_MODEL = process.env.VECTOR_EMBEDDING_MODEL ?? 'nomic-embed-text:v1.5';

// Log embedding status on module load
if (isEmbeddingsEnabled()) {
  console.log(`[Embeddings] Enabled - Model: ${EMBEDDING_MODEL}, URL: ${OLLAMA_BASE_URL}`);
} else {
  console.log(`[Embeddings] Disabled - Set OLLAMA_URL and VECTOR_EMBEDDING_MODEL to enable`);
}

async function embed(text: string): Promise<Float32Array> {
  if (!isEmbeddingsEnabled()) {
    throw new Error('Embeddings not enabled. Set OLLAMA_URL and VECTOR_EMBEDDING_MODEL to enable.');
  }
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });

  if (!res.ok) {
    throw new Error(`Ollama embeddings failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return new Float32Array(data.embedding);
}

export async function embedDocument(text: string): Promise<Float32Array> {
  return embed(`search_document: ${text}`);
}

export async function embedDocumentBatch(texts: string[]): Promise<Float32Array[]> {
  if (!isEmbeddingsEnabled()) {
    throw new Error('Embeddings not enabled. Set OLLAMA_URL and VECTOR_EMBEDDING_MODEL to enable.');
  }
  const prefixed = texts.map(t => `search_document: ${t}`);
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: prefixed }),
  });

  if (!res.ok) {
    throw new Error(`Ollama batch embed failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.embeddings.map((e: number[]) => new Float32Array(e));
}

export async function embedQuery(text: string): Promise<Float32Array> {
  return embed(`search_query: ${text}`);
}

export async function isOllamaAvailable(): Promise<boolean> {
  if (!isEmbeddingsEnabled()) {
    return false;
  }
  try {
    const res = await fetch(OLLAMA_BASE_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
