import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readFile } from "@/lib/sandbox-fs";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json({ error: "path parameter required" }, { status: 400 });
    }

    const result = await readFile(filePath);
    return NextResponse.json({ content: result.content, path: filePath, size: result.size });
  } catch (error: any) {
    console.error("Error reading file:", error);
    return NextResponse.json(
      { error: error.message || "Failed to read file" },
      { status: 500 }
    );
  }
}
