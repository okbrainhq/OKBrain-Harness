
import { NextRequest, NextResponse } from "next/server";
import { getSidebarItems } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type") as "uncategorized" | "folder";
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const folderId = searchParams.get("folderId"); // Optional, for folder type

    if (type !== 'uncategorized' && type !== 'folder') {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const items = await getSidebarItems(session.userId, type, folderId, limit, offset);

    return NextResponse.json(items);
  } catch (error) {
    console.error("Error fetching sidebar items:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
