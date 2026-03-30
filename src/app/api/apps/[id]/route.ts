import { NextResponse } from "next/server";
import { getApp, deleteApp, updateApp, moveAppToFolder, getAppByTitle } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { deleteEntry } from "@/lib/sandbox-fs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/apps/[id]
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const app = await getApp(session.userId, id);
    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }
    return NextResponse.json(app);
  } catch (error) {
    console.error("Error fetching app:", error);
    return NextResponse.json({ error: "Failed to fetch app" }, { status: 500 });
  }
}

// PATCH /api/apps/[id]
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    if (body.title !== undefined && typeof body.title === 'string' && body.title.length > 500) {
      return NextResponse.json({ error: "Title must be 500 characters or fewer" }, { status: 400 });
    }

    if (body.title !== undefined && typeof body.title === 'string' && body.title.trim()) {
      const existing = await getAppByTitle(session.userId, body.title);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: `An app with the name "${body.title}" already exists` }, { status: 409 });
      }
    }

    if (body.title !== undefined || body.description !== undefined) {
      await updateApp(session.userId, id, body.title, body.description);
    }

    if (body.folder_id !== undefined) {
      await moveAppToFolder(session.userId, id, body.folder_id);
    }

    const app = await getApp(session.userId, id);
    return NextResponse.json(app);
  } catch (error) {
    console.error("Error updating app:", error);
    return NextResponse.json({ error: "Failed to update app" }, { status: 500 });
  }
}

// DELETE /api/apps/[id]
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    // Delete sandbox files first
    try {
      await deleteEntry(`apps/${id}`);
    } catch (error) {
      // Directory may not exist, that's fine
      console.warn(`Failed to delete app files for ${id}:`, error);
    }

    await deleteApp(session.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting app:", error);
    return NextResponse.json({ error: "Failed to delete app" }, { status: 500 });
  }
}
