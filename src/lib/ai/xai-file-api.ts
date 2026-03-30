import * as fs from "fs";

const apiKey = process.env.XAI_API_KEY;
const baseURL = "https://api.x.ai/v1";

if (!apiKey) {
  throw new Error("XAI_API_KEY environment variable is required");
}

export interface XAIUploadedFile {
  id: string;
  filename: string;
  bytes: number;
  created_at: number;
}

export async function uploadFile(
  filePath: string,
  mimeType: string,
  displayName?: string
): Promise<XAIUploadedFile> {
  const fileContent = fs.readFileSync(filePath);
  const blob = new Blob([fileContent], { type: mimeType });
  const formData = new FormData();
  formData.append("file", blob, displayName || filePath.split("/").pop());
  formData.append("purpose", "assistants");

  const response = await fetch(`${baseURL}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload file to XAI: ${error}`);
  }

  const file = await response.json();
  return {
    id: file.id,
    filename: file.filename,
    bytes: file.bytes,
    created_at: file.created_at,
  };
}

export async function deleteFile(fileId: string): Promise<void> {
  const response = await fetch(`${baseURL}/files/${fileId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete XAI file: ${error}`);
  }
}

export async function getFile(fileId: string): Promise<XAIUploadedFile | null> {
  try {
    const response = await fetch(`${baseURL}/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) return null;

    const file = await response.json();
    return {
      id: file.id,
      filename: file.filename,
      bytes: file.bytes,
      created_at: file.created_at,
    };
  } catch (error) {
    console.error("Failed to retrieve XAI file:", error);
    return null;
  }
}

export async function listFiles(): Promise<XAIUploadedFile[]> {
  const response = await fetch(`${baseURL}/files`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list XAI files: ${error}`);
  }

  const data = await response.json();
  return data.data.map((file: any) => ({
    id: file.id,
    filename: file.filename,
    bytes: file.bytes,
    created_at: file.created_at,
  }));
}

