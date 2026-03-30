import { NextResponse } from "next/server";
import { getApp, getConversationsByAppId } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/apps/[id]/chats - List conversations for this app
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const app = await getApp(session.userId, id);
    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    const conversations = await getConversationsByAppId(session.userId, id);
    return NextResponse.json(conversations);
  } catch (error) {
    console.error("Error fetching app conversations:", error);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }
}
