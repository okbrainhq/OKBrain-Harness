import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeFileBinary } from "@/lib/sandbox-fs";

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const dirPath = (formData.get('path') as string) || '/';

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 50MB)` },
        { status: 400 }
      );
    }

    // Sanitize filename: strip path separators and null bytes
    const fileName = file.name.replace(/[/\0]/g, '_');
    const filePath = dirPath === '/' ? `/${fileName}` : `${dirPath}/${fileName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFileBinary(filePath, buffer);

    return NextResponse.json({ success: true, path: filePath, name: fileName });
  } catch (error: any) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: error.message || "Failed to upload file" },
      { status: 500 }
    );
  }
}
