"use client";

import { useState } from "react";
import { Check, X, FileText, FilePen, FolderOpen, Search, FilePlus } from "lucide-react";
import type { ToolRendererProps } from "./index";
import styles from "./CodingToolRenderer.module.css";

const TOOL_CONFIG: Record<string, { label: string; pastLabel: string; Icon: any }> = {
  read_file: { label: "Reading", pastLabel: "Read", Icon: FileText },
  write_file: { label: "Writing", pastLabel: "Wrote", Icon: FilePlus },
  patch_file: { label: "Editing", pastLabel: "Edited", Icon: FilePen },
  list_files: { label: "Listing", pastLabel: "Listed", Icon: FolderOpen },
  search_files: { label: "Searching", pastLabel: "Searched", Icon: Search },
};

export default function CodingToolRenderer({
  toolName,
  callContent,
  resultContent,
  state,
}: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_CONFIG[toolName] || { label: "Using", pastLabel: "Used", Icon: FileText };
  // Coding tools are inline (not job-backed), so if resultContent exists the tool is done,
  // even if state is 'running' (can happen with old events that had status field collision).
  const isDone = !!resultContent || state === "succeeded" || state === "failed" || state === "stopped" || state === "timeout";
  const hasFailed = state === "failed" || !!resultContent?.error;

  const args = callContent?.arguments || {};
  const filePath = args.path || callContent?.file_path || "";
  const searchPattern = args.pattern || callContent?.search_pattern || "";

  // Build summary text
  let summaryText = "";
  if (isDone && resultContent) {
    if (resultContent.error) {
      summaryText = "error";
    } else if (toolName === "read_file") {
      const lines = resultContent.total_lines;
      const range = resultContent.range;
      summaryText = range ? `lines ${range}` : lines ? `${lines} lines` : "";
    } else if (toolName === "write_file") {
      const bytes = resultContent.bytes_written;
      summaryText = bytes !== undefined ? `${bytes} bytes` : "";
    } else if (toolName === "patch_file") {
      summaryText = resultContent.patch_status || "patched";
    } else if (toolName === "list_files") {
      summaryText = resultContent.count !== undefined ? `${resultContent.count} items` : "";
    } else if (toolName === "search_files") {
      summaryText = resultContent.count !== undefined ? `${resultContent.count} matches` : "";
    }
  }

  // Content from tool arguments (for write/patch)
  const writeContent = args.content;
  const oldText = args.old_text;
  const newText = args.new_text;

  // Determine if there's expandable content
  const hasBody = isDone && (
    (resultContent?.error) ||
    (toolName === "read_file" && resultContent?.content) ||
    (toolName === "write_file" && writeContent) ||
    (toolName === "patch_file" && oldText) ||
    (toolName === "list_files" && resultContent?.files?.length > 0) ||
    (toolName === "search_files" && resultContent?.matches?.length > 0)
  );

  const actionLabel = isDone ? config.pastLabel : config.label;
  const IconComponent = config.Icon;

  const iconClass = isDone
    ? (hasFailed ? styles.iconFailed : styles.iconSuccess)
    : styles.iconRunning;

  return (
    <div className={styles.card}>
      <button
        type="button"
        onClick={() => hasBody && setExpanded(v => !v)}
        className={`${styles.header} ${expanded ? styles.headerExpanded : ""}`}
        style={{ cursor: hasBody ? "pointer" : "default" }}
      >
        <div className={styles.left}>
          <span className={`${styles.icon} ${iconClass}`}>
            {isDone ? (
              hasFailed ? <X size={14} strokeWidth={2.5} /> : <Check size={14} strokeWidth={2.5} />
            ) : (
              <IconComponent size={14} />
            )}
          </span>
          <span className={styles.action}>{actionLabel}</span>
          {filePath && <span className={styles.filePath}>{filePath}</span>}
          {!filePath && searchPattern && (
            <span className={styles.filePath}>&ldquo;{searchPattern}&rdquo;</span>
          )}
          {summaryText && <span className={styles.summary}>({summaryText})</span>}
        </div>
        {hasBody && (
          <span className={styles.chevron}>{expanded ? "▼" : "▶"}</span>
        )}
      </button>

      {expanded && resultContent?.error && (
        <div className={styles.error}>{resultContent.error}</div>
      )}

      {expanded && toolName === "read_file" && resultContent?.content && (
        <div className={styles.body}>{resultContent.content}</div>
      )}

      {expanded && toolName === "write_file" && writeContent && (
        <div className={styles.body}>{writeContent}</div>
      )}

      {expanded && toolName === "patch_file" && oldText && (
        <div className={styles.diffBody}>
          <div className={styles.diffSection}>
            <div className={styles.diffLabel}>Removed</div>
            <div className={styles.diffRemoved}>{oldText}</div>
          </div>
          <div className={styles.diffSection}>
            <div className={styles.diffLabel}>Added</div>
            <div className={styles.diffAdded}>{newText}</div>
          </div>
        </div>
      )}

      {expanded && toolName === "list_files" && resultContent?.files && (
        <div className={styles.fileList}>
          {resultContent.files.map((entry: any, i: number) => {
            if (typeof entry === "string") {
              return <div key={i} className={styles.fileEntry}>{entry}</div>;
            }
            return (
              <div key={i} className={styles.fileEntry}>
                <span>{entry.type === "directory" ? "d" : "f"}</span>
                <span>{entry.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {expanded && toolName === "search_files" && resultContent?.matches && (
        <div className={styles.matchList}>
          {resultContent.matches.map((m: any, i: number) => (
            <div key={i} className={styles.matchEntry}>
              {m.file && <span className={styles.matchFile}>{m.file}</span>}
              {m.line && <span className={styles.matchLine}>:{m.line}:</span>}
              <span className={styles.matchText}>{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
