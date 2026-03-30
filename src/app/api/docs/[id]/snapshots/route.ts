import { NextResponse } from "next/server";
import { getDocument, getDocumentSnapshots, createSnapshot } from "@/lib/db";
import { getSession } from "@/lib/auth";
import crypto from "crypto";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/docs/[id]/snapshots - List snapshots for a document
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const snapshots = await getDocumentSnapshots(session.userId, id);
    return NextResponse.json(snapshots);
  } catch (error) {
    console.error("Error fetching snapshots:", error);
    return NextResponse.json({ error: "Failed to fetch snapshots" }, { status: 500 });
  }
}

// POST /api/docs/[id]/snapshots - Create a snapshot
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: docId } = await params;
    const { message } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const document = await getDocument(session.userId, docId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const snapshotId = crypto.randomUUID();
    const snapshot = await createSnapshot(
      session.userId,
      docId,
      snapshotId,
      message,
      document.title,
      document.content
    );

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Error creating snapshot:", error);
    return NextResponse.json({ error: "Failed to create snapshot" }, { status: 500 });
  }
}
