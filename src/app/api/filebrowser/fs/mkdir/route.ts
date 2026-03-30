import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createDirectory } from "@/lib/sandbox-fs";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { path: dirPath } = await request.json();

    if (!dirPath || typeof dirPath !== 'string') {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    await createDirectory(dirPath);
    return NextResponse.json({ success: true, path: dirPath });
  } catch (error: any) {
    console.error("Error creating directory:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create directory" },
      { status: 500 }
    );
  }
}
