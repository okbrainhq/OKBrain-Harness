/**
 * Local File API - uploads images to the local server for providers without a FILE API (e.g., Anthropic).
 * Reuses the existing image upload infrastructure (sharp WebP conversion + disk storage).
 */

import fs from 'fs';
import { readFile } from 'fs/promises';
import { UploadedFileResult } from './registry/types';
import { processImageUploadBuffer } from '../uploads';
import { getUploadPath } from '../data-dir';

/**
 * Resolve a local upload URI (e.g., "/uploads/uuid.webp") to base64 data.
 * Used by adapters that need to send images inline (Anthropic, Fireworks, Ollama).
 */
export function resolveLocalFileToBase64(fileUri: string, mimeType: string): { mimeType: string; base64: string } | null {
  const match = fileUri.match(/\/uploads\/([^/?#]+)/);
  if (!match) return null;

  const filename = match[1];
  const filePath = getUploadPath(filename);

  try {
    const buffer = fs.readFileSync(filePath);
    return {
      mimeType: mimeType || 'image/webp',
      base64: buffer.toString('base64'),
    };
  } catch (err) {
    console.error(`[LocalFileAPI] Failed to read local file ${filePath}:`, err);
    return null;
  }
}

export async function uploadFileLocal(
  filePath: string,
  mimeType: string,
  displayName?: string,
  options?: { userId?: string }
): Promise<UploadedFileResult> {
  const buffer = await readFile(filePath);

  const uploaded = await processImageUploadBuffer({
    buffer,
    userId: options?.userId || 'system',
    originalName: displayName,
  });

  return {
    uri: uploaded.url,
    name: uploaded.filename,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.size,
  };
}
