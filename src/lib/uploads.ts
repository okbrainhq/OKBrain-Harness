import { promises as fs, statSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import sharp from "sharp";
import convert from "heic-convert";
import { getUploadPath, getFileUrl, getAbsoluteFileUrl } from "./data-dir";
import { createUpload } from "./db";

const ACCEPTED_IMAGE_FORMATS = new Set(["jpeg", "png", "gif", "webp", "heic", "heif"]);

// Detect HEIC/HEIF by checking for 'ftyp' box with heic/heix/mif1 brands
function isHeicBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const ftypMarker = buffer.toString("ascii", 4, 8);
  if (ftypMarker !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12);
  return ["heic", "heix", "mif1", "heif"].includes(brand);
}
const DEFAULT_ALLOWED_SOURCE_DIRS = [
  "/home/brain-sandbox/upload_images",
];

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

function getAllowedSourceDirs(): string[] {
  const configured = process.env.UPLOAD_TOOL_ALLOWED_DIRS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const dirs = configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_SOURCE_DIRS;
  return dirs.map((dir) => path.resolve(dir));
}

function isInAllowedDir(filePath: string, allowedDirs: string[]): boolean {
  return allowedDirs.some((dir) => filePath === dir || filePath.startsWith(`${dir}${path.sep}`));
}

export async function processImageUploadBuffer(args: {
  buffer: Buffer;
  userId: string;
  originalName?: string;
}): Promise<{
  url: string;
  absoluteUrl?: string;
  filename: string;
  originalName?: string;
  mimeType: string;
  size: number;
}> {
  const { buffer, userId, originalName } = args;

  if (!buffer?.length) {
    throw new Error("No file data provided.");
  }

  if (buffer.length > MAX_UPLOAD_SIZE) {
    throw new Error("File too large. Maximum size is 10MB.");
  }

  // HEIC/HEIF files need pre-conversion since sharp's libvips may not have H.265 codec
  let processBuffer = buffer;
  const isHeic = isHeicBuffer(buffer);
  if (isHeic) {
    const converted = await convert({
      buffer: new Uint8Array(buffer) as unknown as ArrayBufferLike,
      format: "JPEG",
      quality: 0.9,
    });
    processBuffer = Buffer.from(converted as unknown as ArrayBuffer);
  }

  const metadata = await sharp(processBuffer).metadata();
  const format = (metadata.format || "").toLowerCase();
  if (!isHeic && !ACCEPTED_IMAGE_FORMATS.has(format)) {
    throw new Error("Invalid file type. Only image uploads are supported.");
  }

  const filename = `${uuid()}.webp`;
  const outputPath = getUploadPath(filename);

  await sharp(processBuffer).webp({ quality: 80 }).toFile(outputPath);
  await createUpload(uuid(), userId, filename);

  const absoluteUrl = getAbsoluteFileUrl(filename);

  return {
    url: getFileUrl(filename),
    ...(absoluteUrl ? { absoluteUrl } : {}),
    filename,
    originalName,
    mimeType: "image/webp",
    size: statSync(outputPath).size,
  };
}

const SHELL_UPLOAD_DIR = "/home/brain-sandbox/upload_images";

export async function uploadImageFromShellPath(args: {
  filename: string;
  userId: string;
}): Promise<{
  originalName: string;
  url: string;
  absoluteUrl?: string;
  filename: string;
  mimeType: string;
  size: number;
}> {
  const { filename, userId } = args;
  
  // Validate filename - no path traversal
  const basename = path.basename(filename);
  if (!basename || basename !== filename) {
    throw new Error("Invalid filename. Use just the filename without paths (e.g., 'image.png').");
  }
  
  const filePath = path.join(SHELL_UPLOAD_DIR, basename);
  
  let realPath: string;
  try {
    realPath = await fs.realpath(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `File not found: ${basename}. Ensure the file exists in /home/brain-sandbox/upload_images/`
      );
    }
    if (error?.code === "EACCES") {
      throw new Error(
        "Permission denied. Ensure /home/brain-sandbox/upload_images/ has 755 permissions and the file has 644 permissions."
      );
    }
    throw error;
  }
  
  // Verify the resolved path is still in the allowed directory
  const allowedDirs = getAllowedSourceDirs();
  if (!isInAllowedDir(realPath, allowedDirs)) {
    throw new Error(`Path is outside allowed upload directories.`);
  }

  let stat;
  try {
    stat = await fs.stat(realPath);
  } catch (error: any) {
    if (error?.code === "EACCES") {
      throw new Error(
        "Permission denied while reading file metadata. Ensure file has readable permissions."
      );
    }
    throw error;
  }
  
  if (!stat.isFile()) {
    throw new Error("Path is not a file.");
  }

  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error("File too large. Maximum size is 10MB.");
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(realPath);
  } catch (error: any) {
    if (error?.code === "EACCES") {
      throw new Error(
        "Permission denied while reading file. Ensure file has readable permissions."
      );
    }
    throw error;
  }
  
  const uploaded = await processImageUploadBuffer({
    buffer,
    userId,
    originalName: basename,
  });

  return {
    originalName: basename,
    url: uploaded.url,
    ...(uploaded.absoluteUrl ? { absoluteUrl: uploaded.absoluteUrl } : {}),
    filename: uploaded.filename,
    mimeType: uploaded.mimeType,
    size: uploaded.size,
  };
}
