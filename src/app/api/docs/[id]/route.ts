import { NextResponse } from "next/server";
import {
  getDocument,
  deleteDocument,
  updateDocument,
  updateDocumentTitle,
  updateDocumentContent,
  moveDocumentToFolder,
} from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/docs/[id] - Get a specific document
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const document = await getDocument(session.userId, id);
    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(document);
  } catch (error) {
    console.error("Error fetching document:", error);
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 500 }
    );
  }
}

// PATCH /api/docs/[id] - Update document (title, content, or folder)
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    if (body.title !== undefined && typeof body.title === 'string' && body.title.length > 500) {
      return NextResponse.json({ error: "Title must be 500 characters or fewer" }, { status: 400 });
    }
    if (body.content !== undefined && typeof body.content === 'string' && body.content.length > 2_000_000) {
      return NextResponse.json({ error: "Content must be 2MB or less" }, { status: 400 });
    }

    // Update both title and content if provided together
    if (body.title !== undefined && body.content !== undefined) {
      await updateDocument(session.userId, id, body.title, body.content);
    } else {
      // Update title if provided
      if (body.title !== undefined) {
        await updateDocumentTitle(session.userId, id, body.title);
      }

      // Update content if provided
      if (body.content !== undefined) {
        await updateDocumentContent(session.userId, id, body.content);
      }
    }

    // Update folder if provided (can be null to remove from folder)
    if (body.folder_id !== undefined) {
      await moveDocumentToFolder(session.userId, id, body.folder_id);
    }

    const document = await getDocument(session.userId, id);
    return NextResponse.json(document);
  } catch (error) {
    console.error("Error updating document:", error);
    return NextResponse.json(
      { error: "Failed to update document" },
      { status: 500 }
    );
  }
}

// DELETE /api/docs/[id] - Delete a document
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await deleteDocument(session.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}


