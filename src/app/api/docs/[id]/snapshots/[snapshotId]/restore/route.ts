import { NextResponse } from "next/server";
import { getDocumentSnapshot, updateDocument, getDocument } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string; snapshotId: string }>;
}

// POST /api/docs/[id]/snapshots/[snapshotId]/restore - Restore a snapshot
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: docId, snapshotId } = await params;
    const snapshot = await getDocumentSnapshot(session.userId, snapshotId);
    if (!snapshot || snapshot.document_id !== docId) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }

    await updateDocument(session.userId, docId, snapshot.title, snapshot.content);
    const document = await getDocument(session.userId, docId);
    return NextResponse.json(document);
  } catch (error) {
    console.error("Error restoring snapshot:", error);
    return NextResponse.json({ error: "Failed to restore snapshot" }, { status: 500 });
  }
}
