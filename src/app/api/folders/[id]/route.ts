import { NextResponse } from "next/server";
import {
  getFolder,
  deleteFolder,
  updateFolderName,
} from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/folders/[id] - Get a specific folder
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const folder = await getFolder(session.userId, id);
    if (!folder) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error fetching folder:", error);
    return NextResponse.json(
      { error: "Failed to fetch folder" },
      { status: 500 }
    );
  }
}

// PATCH /api/folders/[id] - Update folder name
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { name } = await request.json();
    const result = await updateFolderName(session.userId, id, name);
    if (result === 'not_found') {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (result === 'forbidden') {
      return NextResponse.json({ error: "Shared folder cannot be renamed" }, { status: 403 });
    }

    const folder = await getFolder(session.userId, id);
    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error updating folder:", error);
    return NextResponse.json(
      { error: "Failed to update folder" },
      { status: 500 }
    );
  }
}

// DELETE /api/folders/[id] - Delete a folder
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const result = await deleteFolder(session.userId, id);
    if (result === 'not_found') {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (result === 'forbidden') {
      return NextResponse.json({ error: "Shared folder cannot be deleted" }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 }
    );
  }
}
