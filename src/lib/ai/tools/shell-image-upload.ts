import { Tool, ToolDefinition } from "./types";
import { requireUserId } from "./context";
import { uploadImageFromShellPath } from "@/lib/uploads";

const MAX_FILES_PER_CALL = 5;

// Base directory for shell-generated images
const SHELL_UPLOAD_DIR = "/home/brain-sandbox/upload_images";

const shellImageUploadDefinition: ToolDefinition = {
  name: "shell_image_upload",
  shortDescription: 'Upload images from /home/brain-sandbox/upload_images/. Returns relative URLs (starting with /). Render using: <img src="URL" alt="DESCRIPTION" /> — use the returned URL exactly as-is, do not add a hostname.',
  description: `Upload images created by run_shell_command.

Save images to: /home/brain-sandbox/upload_images/<filename>
Call this tool with filename only (no path).

After upload, render using:
<img src="URL" alt="DESCRIPTION" width="WIDTH" />

Use the returned url exactly as provided.
Never fabricate image URLs.
WIDTH is optional and should be a pixel value when needed.`,
  parameters: {
    type: "OBJECT",
    properties: {
      files: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            filename: {
              type: "STRING",
              description: "Filename only (e.g., 'chart.png'). The file must be in /home/brain-sandbox/upload_images/",
            },
          },
          required: ["filename"],
        },
        description: "List of files to upload. Just the filename, not the full path. Max 5 files per call.",
      },
    },
    required: ["files"],
  },
};

async function executeShellImageUpload(args: {
  files?: Array<{ filename?: string }>;
}): Promise<any> {
  const userId = requireUserId();
  const inputFiles = Array.isArray(args?.files) ? args.files : [];

  if (inputFiles.length === 0) {
    return { error: "No files provided for upload." };
  }

  if (inputFiles.length > MAX_FILES_PER_CALL) {
    return { error: `Too many files. Maximum is ${MAX_FILES_PER_CALL} per call.` };
  }

  const filenames = inputFiles
    .map((file) => (file?.filename || "").trim())
    .filter(Boolean);

  if (filenames.length === 0) {
    return { error: "No valid filenames provided." };
  }

  const results = await Promise.all(
    filenames.map(async (filename) => {
      try {
        const uploaded = await uploadImageFromShellPath({ filename, userId });
        return { filename, uploaded };
      } catch (error: any) {
        console.error("[TOOL shell_image_upload] Failed to upload file", {
          filename,
          error: error?.message || String(error),
        });
        return {
          filename,
          error: error?.message || "Upload failed.",
        };
      }
    })
  );

  const files = results
    .filter((result) => !("error" in result))
    .map((result: any) => ({
      filename: result.uploaded.filename,
      originalName: result.uploaded.originalName,
      url: result.uploaded.url,
      mimeType: result.uploaded.mimeType,
      size: result.uploaded.size,
    }));

  const errors = results
    .filter((result) => "error" in result)
    .map((result: any) => ({ filename: result.filename, error: result.error }));

  if (files.length === 0) {
    console.error("[TOOL shell_image_upload] All uploads failed", {
      userId,
      filenames,
      errors,
    });
    return {
      error: "Failed to upload all files.",
      errors,
    };
  }

  return {
    files,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export const shellImageUploadTools: Tool[] = [
  { definition: shellImageUploadDefinition, execute: executeShellImageUpload },
];
