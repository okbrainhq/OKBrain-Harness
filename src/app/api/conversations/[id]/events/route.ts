import { NextResponse } from "next/server";
import { getConversation, getChatEvents } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/conversations/[id]/events - Get chat events for a conversation
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const conversation = await getConversation(session.userId, id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const chatEvents = await getChatEvents(id);
    const parsedEvents = chatEvents.map((e: any) => ({
      ...e,
      content: (() => {
        try {
          return typeof e.content === "string" ? JSON.parse(e.content) : e.content;
        } catch {
          return e.content;
        }
      })(),
    }));

    return NextResponse.json({ events: parsedEvents, conversation });
  } catch (error) {
    console.error("Error fetching conversation events:", error);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
