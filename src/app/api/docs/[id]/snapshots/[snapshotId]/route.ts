import { NextResponse } from "next/server";
import { getDocumentSnapshot, deleteSnapshot } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string; snapshotId: string }>;
}

// GET /api/docs/[id]/snapshots/[snapshotId] - Get a single snapshot
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { snapshotId } = await params;
    const snapshot = await getDocumentSnapshot(session.userId, snapshotId);
    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Error fetching snapshot:", error);
    return NextResponse.json({ error: "Failed to fetch snapshot" }, { status: 500 });
  }
}

// DELETE /api/docs/[id]/snapshots/[snapshotId] - Delete a snapshot
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { snapshotId } = await params;
    await deleteSnapshot(session.userId, snapshotId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting snapshot:", error);
    return NextResponse.json({ error: "Failed to delete snapshot" }, { status: 500 });
  }
}
