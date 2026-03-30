import { getSession } from "@/lib/auth";
import { searchFactsByEmbedding } from "@/lib/db";
import { embedQuery, isEmbeddingsEnabled, isOllamaAvailable } from "@/lib/ai/embeddings";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isEmbeddingsEnabled()) {
    return new Response(JSON.stringify({ error: "Semantic search not enabled. Set OLLAMA_URL and VECTOR_EMBEDDING_MODEL to enable." }), {
      status: 501,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q || !q.trim()) {
    return new Response(JSON.stringify({ error: "q parameter is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10"), 1), 50);
  const maxDistance = parseFloat(url.searchParams.get("max_distance") || "1.0");

  // Check if Ollama is actually available (returns 503 if configured but down)
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) {
    return new Response(JSON.stringify({ error: "Embedding service unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const queryEmbedding = await embedQuery(q.trim());
    const results = await searchFactsByEmbedding(session.userId, queryEmbedding, limit, maxDistance);

    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[FactSearch] Error:", error);
    return new Response(JSON.stringify({ error: "Search failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
