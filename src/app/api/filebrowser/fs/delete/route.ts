import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteEntry } from "@/lib/sandbox-fs";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { path: targetPath } = await request.json();

    if (!targetPath || typeof targetPath !== 'string') {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    if (targetPath === '/' || targetPath === '') {
      return NextResponse.json({ error: "Cannot delete the home directory" }, { status: 400 });
    }

    await deleteEntry(targetPath);
    return NextResponse.json({ success: true, path: targetPath });
  } catch (error: any) {
    console.error("Error deleting entry:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete" },
      { status: 500 }
    );
  }
}
