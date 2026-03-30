import { getSession } from "@/lib/auth";
import { getLatestFactSheet, getLatestFactSheetBySource, updateFactSheetFacts } from "@/lib/db";
import type { FactSheetEntry } from "@/lib/db";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get("source");

  const sheet = source
    ? await getLatestFactSheetBySource(session.userId, source)
    : await getLatestFactSheet(session.userId);

  if (!sheet) {
    return new Response(JSON.stringify(null), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let facts: FactSheetEntry[];
  try {
    facts = JSON.parse(sheet.facts_json);
  } catch {
    facts = [];
  }

  // SQLite CURRENT_TIMESTAMP is UTC but lacks 'Z' suffix — append it so JS parses correctly
  const createdAt = sheet.created_at.endsWith('Z') ? sheet.created_at : sheet.created_at + 'Z';

  return new Response(
    JSON.stringify({
      id: sheet.id,
      facts,
      created_at: createdAt,
      fact_count: sheet.fact_count,
      source: sheet.source,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
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

  const body = await req.json();
  const { sheetId, facts } = body as {
    sheetId: string;
    facts: FactSheetEntry[];
  };

  if (!sheetId || !Array.isArray(facts)) {
    return new Response(JSON.stringify({ error: "sheetId and facts array required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate all facts have valid categories
  for (const fact of facts) {
    if (!VALID_CATEGORIES.includes(fact.category)) {
      return new Response(JSON.stringify({ error: `Invalid category: ${fact.category}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!fact.fact || !fact.fact.trim()) {
      return new Response(JSON.stringify({ error: "Empty fact text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const updated = await updateFactSheetFacts(
    sheetId,
    session.userId,
    JSON.stringify(facts),
    facts.length
  );

  if (!updated) {
    return new Response(JSON.stringify({ error: "Fact sheet not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
