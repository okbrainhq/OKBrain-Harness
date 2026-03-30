import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeFile } from "@/lib/sandbox-fs";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { path: filePath, content } = await request.json();

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }

    if (content.length > 500 * 1024) {
      return NextResponse.json({ error: "Content too large (max 500KB)" }, { status: 400 });
    }

    await writeFile(filePath, content);
    return NextResponse.json({ success: true, path: filePath });
  } catch (error: any) {
    console.error("Error writing file:", error);
    return NextResponse.json(
      { error: error.message || "Failed to write file" },
      { status: 500 }
    );
  }
}
