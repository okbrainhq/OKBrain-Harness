import { NextResponse } from "next/server";
import { getAllConversations, createConversation } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { getSession } from "@/lib/auth";

// GET /api/conversations - List all conversations
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const conversations = await getAllConversations(session.userId);
    return NextResponse.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

// POST /api/conversations - Create a new conversation
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { title } = await request.json();
    const id = uuid();
    const conversation = await createConversation(session.userId, id, title || "New Chat");
    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Error creating conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}


