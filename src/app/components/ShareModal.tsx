"use client";

import { useState } from "react";
import { Modal } from "./primitive/Modal";
import { Button } from "./primitive/Button";
import { Copy, Check, Share2, Globe } from "lucide-react";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'conversation' | 'document' | 'snapshot';
  resourceId: string;
}

export default function ShareModal({ isOpen, onClose, type, resourceId }: ShareModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerateLink = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, resourceId }),
      });
      const data = await res.json();
      if (data.url) {
        setUrl(data.url);
      }
    } catch (error) {
      console.error("Failed to generate share link:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (url) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share Publicly"
      footer={
        <Button variant="secondary" onClick={onClose} fullWidth={false}>
          Close
        </Button>
      }
    >
      <div style={{ padding: "16px 4px" }}>
        {!url ? (
          <div style={{ textAlign: "center", padding: "12px 0 8px" }}>
            <div style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "var(--bg-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-light)"
            }}>
              <Share2 size={24} />
            </div>
            <h4 style={{ marginBottom: "12px", fontSize: "1.1rem", fontWeight: 600 }}>Create a public link</h4>
            <p style={{
              fontSize: "0.95rem",
              color: "var(--text-muted)",
              marginBottom: "24px",
              lineHeight: 1.5,
              maxWidth: "320px",
              margin: "0 auto 28px"
            }}>
              Anyone with the link will be able to view this {type}.
              Your other data and history remain private.
            </p>
            <Button
              id="generate-share-link"
              onClick={handleGenerateLink}
              isLoading={isLoading}
              fullWidth={false}
              icon={<Globe size={16} />}
              style={{ padding: "10px 24px" }}
            >
              Generate Public Link
            </Button>
          </div>
        ) : (
          <div style={{ padding: "8px 4px" }}>
            <div
              id="share-url-container"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "24px",
                marginBottom: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px"
              }}
            >
              <div style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                <Globe size={14} />
                Public Link
              </div>
              <div style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
                background: "var(--bg-secondary)",
                padding: "12px 16px",
                borderRadius: "12px",
                border: "1px solid var(--border-light)",
                boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)"
              }}>
                <div
                  id="share-url-text"
                  style={{
                    flex: 1,
                    fontSize: "0.85rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono, monospace)",
                    letterSpacing: "-0.01em"
                  }}
                >
                  {url}
                </div>
                <button
                  onClick={handleCopy}
                  title="Copy to clipboard"
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)",
                    color: copied ? "#4ade80" : "var(--text-secondary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    padding: "6px",
                    borderRadius: "6px",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              background: "var(--accent-dim)",
              padding: "8px 16px",
              borderRadius: "20px",
              width: "fit-content",
              margin: "0 auto"
            }}>
              <Check size={14} style={{ color: "#4ade80" }} />
              <span>Link is active and ready to share</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
