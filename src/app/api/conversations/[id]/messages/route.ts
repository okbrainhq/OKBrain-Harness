import { NextResponse } from "next/server";
import { getConversation, getChatEvents } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/conversations/[id]/messages - Get messages for a conversation (derived from chat_events)
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const conversation = await getConversation(session.userId, id);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const events = await getChatEvents(id);

    // Convert chat events to a message-like format for backward compatibility
    const messages = events
      .filter(e => e.kind === 'user_message' || e.kind === 'assistant_text' || e.kind === 'summary')
      .map(e => {
        let parsed: any;
        try {
          parsed = typeof e.content === 'string' ? JSON.parse(e.content) : e.content;
        } catch {
          parsed = { text: typeof e.content === 'string' ? e.content : '' };
        }
        const role = e.kind === 'user_message' ? 'user' : e.kind === 'summary' ? 'summary' : 'assistant';
        const attachments = role === 'user' && Array.isArray(parsed.attachments) ? parsed.attachments : undefined;
        return {
          id: e.id,
          conversation_id: e.conversation_id,
          role,
          content: parsed.text || '',
          model: parsed.model || null,
          created_at: e.created_at,
          ...(attachments ? { fileCount: attachments.length, attachments } : {}),
        };
      });

    return NextResponse.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
