// Google Gemini FILE API integration
// Handles file uploads to Google's FILE API for use with Gemini

import { GoogleGenAI, File } from "@google/genai";

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  throw new Error("GOOGLE_API_KEY environment variable is required");
}

// Initialize the client
const ai = new GoogleGenAI({ apiKey });

export interface UploadedFile {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
}

/**
 * Upload a file to Google's FILE API
 * @param filePath - Path to the file to upload
 * @param mimeType - MIME type of the file
 * @param displayName - Optional display name for the file
 * @returns Uploaded file metadata including URI
 */
export async function uploadFile(
  filePath: string,
  mimeType: string,
  displayName?: string
): Promise<UploadedFile> {
  try {
    const uploadResult = await ai.files.upload({
      file: filePath,
      config: {
        mimeType,
        displayName,
      },
    });

    return {
      uri: uploadResult.uri || "",
      name: uploadResult.name || "",
      mimeType: uploadResult.mimeType || mimeType,
      sizeBytes: parseInt(uploadResult.sizeBytes || "0"),
      createTime: uploadResult.createTime || "",
      updateTime: uploadResult.updateTime || "",
      expirationTime: uploadResult.expirationTime || "",
      sha256Hash: uploadResult.sha256Hash || "",
    };
  } catch (error: any) {
    console.error("[FILE_API] Upload failed:", error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Get file metadata from Google's FILE API
 * @param fileName - The file name (e.g., "files/abc123")
 * @returns File metadata
 */
export async function getFile(fileName: string): Promise<UploadedFile | null> {
  try {
    const file = await ai.files.get({ name: fileName });

    return {
      uri: file.uri || "",
      name: file.name || "",
      mimeType: file.mimeType || "",
      sizeBytes: parseInt(file.sizeBytes || "0"),
      createTime: file.createTime || "",
      updateTime: file.updateTime || "",
      expirationTime: file.expirationTime || "",
      sha256Hash: file.sha256Hash || "",
    };
  } catch (error: any) {
    if (error.message?.includes("404") || error.message?.includes("not found")) {
      return null; // File not found or expired
    }
    console.error("[FILE_API] Get file failed:", error);
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
}

/**
 * Delete a file from Google's FILE API
 * @param fileName - The file name to delete (e.g., "files/abc123")
 */
export async function deleteFile(fileName: string): Promise<void> {
  try {
    await ai.files.delete({ name: fileName });
  } catch (error: any) {
    console.error("[FILE_API] Delete failed:", error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

/**
 * List all files in the FILE API
 * @returns Array of file metadata
 */
export async function listFiles(): Promise<UploadedFile[]> {
  try {
    const pager = await ai.files.list();
    const files: UploadedFile[] = [];

    for await (const file of pager) {
      files.push({
        uri: file.uri || "",
        name: file.name || "",
        mimeType: file.mimeType || "",
        sizeBytes: parseInt(file.sizeBytes || "0"),
        createTime: file.createTime || "",
        updateTime: file.updateTime || "",
        expirationTime: file.expirationTime || "",
        sha256Hash: file.sha256Hash || "",
      });
    }

    return files;
  } catch (error: any) {
    console.error("[FILE_API] List files failed:", error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
}

/**
 * Check if a file has expired based on its expiration time
 * @param expirationTime - ISO timestamp of when the file expires
 * @returns true if expired, false otherwise
 */
export function isFileExpired(expirationTime: string): boolean {
  const expirationDate = new Date(expirationTime);
  const now = new Date();
  return now >= expirationDate;
}

/**
 * Get hours until file expires
 * @param expirationTime - ISO timestamp of when the file expires
 * @returns Hours until expiration (negative if already expired)
 */
export function getHoursUntilExpiration(expirationTime: string): number {
  const expirationDate = new Date(expirationTime);
  const now = new Date();
  const diffMs = expirationDate.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60); // Convert to hours
}
