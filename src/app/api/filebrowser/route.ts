import { NextResponse } from "next/server";
import { createFileBrowser, getFolder } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { getSession } from "@/lib/auth";

// POST /api/filebrowser - Create a new file browser
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { title, folder_id } = await request.json();
    let targetFolderId: string | null = null;
    if (folder_id) {
      const folder = await getFolder(session.userId, folder_id);
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 400 });
      }
      targetFolderId = folder_id;
    }
    const id = uuid();
    const fileBrowser = await createFileBrowser(session.userId, id, title || "File Browser", targetFolderId);
    return NextResponse.json(fileBrowser);
  } catch (error) {
    console.error("Error creating file browser:", error);
    return NextResponse.json(
      { error: "Failed to create file browser" },
      { status: 500 }
    );
  }
}
