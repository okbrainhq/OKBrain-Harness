import { NextResponse } from "next/server";
import { getAllFolders, createFolder } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { getSession } from "@/lib/auth";

// GET /api/folders - List all folders
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const folders = await getAllFolders(session.userId);
    return NextResponse.json(folders);
  } catch (error) {
    console.error("Error fetching folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch folders" },
      { status: 500 }
    );
  }
}

// POST /api/folders - Create a new folder
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name } = await request.json();
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.toLowerCase() === 'shared') {
      return NextResponse.json(
        { error: "The Shared folder name is reserved" },
        { status: 400 }
      );
    }
    const id = uuid();
    const folder = await createFolder(session.userId, id, trimmedName || "New Folder");
    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 }
    );
  }
}
