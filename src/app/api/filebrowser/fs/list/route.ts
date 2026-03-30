import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listDirectory } from "@/lib/sandbox-fs";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = request.nextUrl.searchParams;
    const dirPath = searchParams.get("path") || "/";

    const entries = await listDirectory(dirPath);
    return NextResponse.json({ entries, path: dirPath });
  } catch (error: any) {
    console.error("Error listing directory:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list directory" },
      { status: 500 }
    );
  }
}
