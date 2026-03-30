import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renameEntry } from "@/lib/sandbox-fs";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { oldPath, newPath } = await request.json();

    if (!oldPath || typeof oldPath !== 'string') {
      return NextResponse.json({ error: "oldPath is required" }, { status: 400 });
    }

    if (!newPath || typeof newPath !== 'string') {
      return NextResponse.json({ error: "newPath is required" }, { status: 400 });
    }

    await renameEntry(oldPath, newPath);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error renaming:", error);
    return NextResponse.json(
      { error: error.message || "Failed to rename" },
      { status: 500 }
    );
  }
}
