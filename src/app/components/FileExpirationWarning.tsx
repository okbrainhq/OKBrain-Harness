"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

interface FileAttachment {
  id: string;
  message_id: string;
  file_uri: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
  created_at: string;
}

interface FileExpirationWarningProps {
  messageId: string;
  role: "user" | "assistant";
  attachments?: FileAttachment[];
}

export default function FileExpirationWarning({ messageId, role, attachments = [] }: FileExpirationWarningProps) {
  const [expiredFiles, setExpiredFiles] = useState<FileAttachment[]>([]);

  useEffect(() => {
    // Only check for user messages (where files are attached)
    if (role !== "user" || attachments.length === 0) {
      return;
    }

    // Check which files are expired (48 hours from upload)
    const expired = attachments.filter((file: FileAttachment) => {
      const uploadedAt = new Date(file.uploaded_at);
      const expirationTime = new Date(uploadedAt.getTime() + 48 * 60 * 60 * 1000);
      return new Date() >= expirationTime;
    });

    setExpiredFiles(expired);
  }, [attachments, role]);

  // Don't show anything if no attachments
  if (role !== "user" || attachments.length === 0) {
    return null;
  }

  // Only show warning if files have expired
  if (expiredFiles.length === 0) {
    return null;
  }

  return (
    <div className="file-expiration-warning">
      <AlertCircle size={14} className="warning-icon" />
      <div className="warning-text">
        {expiredFiles.length === attachments.length ? (
          <>File{expiredFiles.length > 1 ? 's' : ''} expired (48h limit)</>
        ) : (
          <>{expiredFiles.length}/{attachments.length} file{expiredFiles.length > 1 ? 's' : ''} expired</>
        )}
      </div>
    </div>
  );
}
