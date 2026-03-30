import { NextRequest, NextResponse } from "next/server";
import { searchConversations, searchDocuments, searchFileBrowsers, searchApps } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");

    if (!query || query.length < 2) {
      return NextResponse.json({ conversations: [], documents: [], fileBrowsers: [], apps: [] });
    }

    const [conversations, documents, fileBrowsers, apps] = await Promise.all([
      searchConversations(session.userId, query),
      searchDocuments(session.userId, query),
      searchFileBrowsers(session.userId, query),
      searchApps(session.userId, query),
    ]);

    return NextResponse.json({ conversations, documents, fileBrowsers, apps });
  } catch (error) {
    console.error("Error searching:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
