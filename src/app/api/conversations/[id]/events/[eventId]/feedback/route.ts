import { getSession } from "@/lib/auth";
import { getConversation, updateChatEventFeedback } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id: conversationId, eventId } = await params;

    // Verify conversation ownership
    const conversation = await getConversation(session.userId, conversationId);
    if (!conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const { feedback } = body;

    if (feedback !== 1 && feedback !== -1 && feedback !== null) {
      return new Response(JSON.stringify({ error: "Feedback must be 1, -1, or null" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await updateChatEventFeedback(eventId, feedback);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Event feedback error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to update feedback" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
