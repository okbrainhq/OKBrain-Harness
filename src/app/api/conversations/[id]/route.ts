import { NextResponse } from "next/server";
import {
  getConversation,
  deleteConversation,
  updateConversationTitle,
  moveConversationToFolder,
  getLatestActiveChatYieldSessionForConversation,
} from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/conversations/[id] - Get a specific conversation
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
    // Check for active yield sessions so polling clients know the conversation is still yielding
    const activeYieldSession = await getLatestActiveChatYieldSessionForConversation(id);
    return NextResponse.json({
      ...conversation,
      is_yielding: !!activeYieldSession,
    });
  } catch (error) {
    console.error("Error fetching conversation:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    );
  }
}

// PATCH /api/conversations/[id] - Update conversation (title or folder)
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    if (body.title !== undefined && typeof body.title === 'string' && body.title.length > 500) {
      return NextResponse.json({ error: "Title must be 500 characters or fewer" }, { status: 400 });
    }

    // Update title if provided
    if (body.title !== undefined) {
      await updateConversationTitle(session.userId, id, body.title);
    }

    // Update folder if provided (can be null to remove from folder)
    if (body.folder_id !== undefined) {
      await moveConversationToFolder(session.userId, id, body.folder_id);
    }

    const conversation = await getConversation(session.userId, id);
    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Error updating conversation:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

// DELETE /api/conversations/[id] - Delete a conversation
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await deleteConversation(session.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}


