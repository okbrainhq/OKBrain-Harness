// API route for uploading files to AI provider FILE APIs

import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { v4 as uuid } from "uuid";
import { uploadFileForModel, getModel } from "@/lib/ai";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const modelId = (formData.get("provider") as string) || 'gemini';

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Use registry to validate - no hardcoded provider checks
    let model;
    try {
      model = getModel(modelId);
    } catch {
      return NextResponse.json(
        { error: `Unknown model: ${modelId}` },
        { status: 400 }
      );
    }

    if (!model.capabilities.fileUpload) {
      return NextResponse.json(
        { error: `File uploads are not supported for ${model.name}.` },
        { status: 400 }
      );
    }

    // Validate file type (images, PDFs, and text files)
    const validTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/html',
      'text/css',
      'text/javascript',
      'application/json',
      'application/xml',
    ];

    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Supported: images, PDFs, and text files (.txt, .md, .csv, .html, .css, .js, .json, .xml)." },
        { status: 400 }
      );
    }

    // Validate file size (max 20MB for FILE API, but we'll use 10MB for safety)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create temporary file path
    const tempFileName = `${uuid()}-${file.name}`;
    const tempFilePath = join(tmpdir(), tempFileName);

    // Write to temporary file
    await writeFile(tempFilePath, buffer);

    try {
      // Upload via provider registry
      const uploaded = await uploadFileForModel(modelId, tempFilePath, file.type, file.name, { userId: session.userId });

      // Delete temporary file
      await unlink(tempFilePath);

      return NextResponse.json({
        success: true,
        file: {
          uri: uploaded.uri,
          name: uploaded.name,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          expirationTime: uploaded.expirationTime,
        },
      });
    } catch (uploadError: any) {
      // Clean up temp file on upload error
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }

      console.error("[UPLOAD] FILE API upload failed:", uploadError);
      return NextResponse.json(
        { error: "File upload failed. Please try again." },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("[UPLOAD] Request processing failed:", error);
    return NextResponse.json(
      { error: "Failed to process upload request" },
      { status: 500 }
    );
  }
}
