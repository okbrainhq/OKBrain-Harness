import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processImageUploadBuffer, MAX_UPLOAD_SIZE } from "@/lib/uploads";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only images (JPEG, PNG, GIF, WebP, HEIC, HEIF) are supported." },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uploaded = await processImageUploadBuffer({
      buffer,
      userId: session.userId,
      originalName: file.name,
    });

    return NextResponse.json({
      url: uploaded.url,
      ...(uploaded.absoluteUrl ? { absoluteUrl: uploaded.absoluteUrl } : {}),
      filename: uploaded.filename,
      originalName: uploaded.originalName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
    });
  } catch (error: any) {
    console.error("[UPLOAD] Failed:", error);
    const message = error?.message || "Failed to process upload";
    if (
      message.includes("Invalid file type") ||
      message.includes("File too large") ||
      message.includes("No file data provided")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}
