import { getSession } from "@/lib/auth";
import { getUserKV, setUserKV } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return new Response(JSON.stringify({ error: "Key is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await getUserKV(session.userId, key);
  return new Response(JSON.stringify({ value: result?.value || null }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { key, value } = body;

  if (!key) {
    return new Response(JSON.stringify({ error: "Key is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await setUserKV(session.userId, key, value);
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
