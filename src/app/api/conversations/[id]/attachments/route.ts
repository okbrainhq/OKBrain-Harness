// API route for retrieving all file attachments for a conversation

import { NextRequest, NextResponse } from "next/server";
import { getConversationFileAttachments } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: conversationId } = await params;

    if (!conversationId) {
      return NextResponse.json(
        { error: "Conversation ID is required" },
        { status: 400 }
      );
    }

    const attachments = await getConversationFileAttachments(session.userId, conversationId);

    return NextResponse.json({
      success: true,
      attachments,
    });
  } catch (error: any) {
    console.error("[CONVERSATION_ATTACHMENTS] Failed to get attachments:", error);
    return NextResponse.json(
      { error: "Failed to retrieve attachments" },
      { status: 500 }
    );
  }
}
