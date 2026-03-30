import { getSession } from "@/lib/auth";
import { getUserMemory, updateUserMemory } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = session.userId;

  const memory = await getUserMemory(userId);
  return new Response(JSON.stringify({ memory_text: memory?.memory_text || "" }), {
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
  const userId = session.userId;

  try {
    const { memoryText } = await request.json();

    if (typeof memoryText !== 'string') {
      return new Response(JSON.stringify({ error: "Invalid memoryText" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await updateUserMemory(userId, memoryText);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error updating memory:", error);
    return new Response(JSON.stringify({ error: "Failed to update memory" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
