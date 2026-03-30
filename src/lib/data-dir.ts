import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DATA_DIR = process.env.UPLOAD_DATA_DIR || './data';

function ensureUploadDir(): void {
  const uploadDir = path.join(UPLOAD_DATA_DIR, 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

export function getUploadPath(filename: string): string {
  ensureUploadDir();
  return path.join(UPLOAD_DATA_DIR, 'uploads', filename);
}

export function getFileUrl(filename: string): string {
  return `/uploads/${filename}`;
}

export function getAbsoluteFileUrl(filename: string): string | null {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) return null;

  try {
    return new URL(getFileUrl(filename), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}
