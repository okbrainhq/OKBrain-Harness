import { NextResponse } from "next/server";
import {
  getFileBrowser,
  deleteFileBrowser,
  updateFileBrowser,
  moveFileBrowserToFolder,
} from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/filebrowser/[id]
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const fileBrowser = await getFileBrowser(session.userId, id);
    if (!fileBrowser) {
      return NextResponse.json({ error: "File browser not found" }, { status: 404 });
    }
    return NextResponse.json(fileBrowser);
  } catch (error) {
    console.error("Error fetching file browser:", error);
    return NextResponse.json({ error: "Failed to fetch file browser" }, { status: 500 });
  }
}

// PATCH /api/filebrowser/[id]
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    if (body.title !== undefined && typeof body.title === 'string' && body.title.length > 500) {
      return NextResponse.json({ error: "Title must be 500 characters or fewer" }, { status: 400 });
    }

    if (body.title !== undefined || body.current_path !== undefined) {
      await updateFileBrowser(session.userId, id, body.title, body.current_path);
    }

    if (body.folder_id !== undefined) {
      await moveFileBrowserToFolder(session.userId, id, body.folder_id);
    }

    const fileBrowser = await getFileBrowser(session.userId, id);
    return NextResponse.json(fileBrowser);
  } catch (error) {
    console.error("Error updating file browser:", error);
    return NextResponse.json({ error: "Failed to update file browser" }, { status: 500 });
  }
}

// DELETE /api/filebrowser/[id]
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await deleteFileBrowser(session.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting file browser:", error);
    return NextResponse.json({ error: "Failed to delete file browser" }, { status: 500 });
  }
}
