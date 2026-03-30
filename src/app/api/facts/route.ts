import { getSession } from "@/lib/auth";
import { getUserFacts, deleteFact, updateFact, saveFactEmbedding, deleteFactEmbedding } from "@/lib/db";
import { embedDocument, isEmbeddingsEnabled } from "@/lib/ai/embeddings";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const facts = await getUserFacts(session.userId);

  return new Response(JSON.stringify({ facts }), {
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_CATEGORIES = ["core", "technical", "project", "transient"];

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { factId, category, fact } = await req.json();
  if (!factId || !category || !fact) {
    return new Response(JSON.stringify({ error: "factId, category, and fact are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return new Response(JSON.stringify({ error: "Invalid category" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const trimmedFact = fact.trim();
  await updateFact(session.userId, factId, category, trimmedFact);

  // Re-embed the fact with updated text (only if embeddings enabled)
  if (isEmbeddingsEnabled()) {
    try {
      const embedding = await embedDocument(trimmedFact);
      await saveFactEmbedding(factId, session.userId, embedding);
    } catch (error) {
      console.error('[FactEmbedding] Failed to re-embed fact on update:', error);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { factId } = await req.json();
  if (!factId) {
    return new Response(JSON.stringify({ error: "factId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await deleteFact(session.userId, factId);

  // Clean up orphaned embedding (only if embeddings enabled)
  if (isEmbeddingsEnabled()) {
    try {
      await deleteFactEmbedding(factId);
    } catch (error) {
      console.error('[FactEmbedding] Failed to delete embedding on fact delete:', error);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
