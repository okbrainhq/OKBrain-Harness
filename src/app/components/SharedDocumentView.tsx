"use client";

import { useRouter } from "next/navigation";
import TiptapEditor from "./TiptapEditor";
import { Globe, Camera, Sparkles } from "lucide-react";
import { Button } from "./primitive/Button";
import "./DocumentEditor.module.css";

interface SharedDocumentViewProps {
  title: string;
  content: string;
  snapshotMessage?: string;
  snapshotDate?: string;
  sharedLinkId?: string;
}

export default function SharedDocumentView({ title, content, snapshotMessage, snapshotDate, sharedLinkId }: SharedDocumentViewProps) {
  const router = useRouter();

  return (
    <div className="document-container" style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5in;
            size: auto;
          }
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: white !important;
            color: black !important;
          }
          main {
            height: auto !important;
            overflow: visible !important;
            display: block !important;
          }
          .document-container {
            padding: 0 0.5in !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            display: block !important;
            background: white !important;
          }
          .document-editor {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .shared-header-badge,
          .shared-footer {
            display: none !important;
          }
          .shared-doc-title {
            font-size: 2.25rem !important;
            font-weight: 700 !important;
            margin-bottom: 24px !important;
            line-height: 1.3 !important;
            color: black !important;
            display: block !important;
            padding: 0 !important;
            text-align: left !important; /* Standard doc print is usually left-aligned */
          }
          header {
            margin-bottom: 24px !important;
            text-align: left !important;
          }
          /* Ensure Tiptap content is black */
          .tiptap {
            color: black !important;
          }
          .tiptap p, .tiptap h1, .tiptap h2, .tiptap h3, .tiptap ul, .tiptap ol, .tiptap li {
            color: black !important;
          }
        }
      `}</style>

      <div className="document-editor" style={{ maxWidth: '700px', margin: '0 auto', padding: '60px 20px' }}>
        <header style={{ marginBottom: '48px', textAlign: 'center', position: 'relative' }}>

          <div className="shared-header-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--accent-cyan)', marginBottom: '16px' }}>
            {snapshotMessage ? <Camera size={18} /> : <Globe size={18} />}
            <span style={{ fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.7rem', opacity: 0.8 }}>
              {snapshotMessage
                ? 'Snapshot'
                : 'Publicly Shared Document'}
            </span>
            {snapshotDate && (
              <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>
                {' — '}{new Date(snapshotDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
          <h1 className="shared-doc-title" style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1.2, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>{title}</h1>
          {sharedLinkId && (
            <div style={{ marginTop: "20px", display: "flex", justifyContent: "center" }}>
              <Button
                onClick={() => router.push(`/?sharedLinkId=${sharedLinkId}`)}
                icon={<Sparkles size={16} />}
                fullWidth={false}
                className="ask-ai-button"
              >
                Ask
              </Button>
            </div>
          )}
        </header>

        <TiptapEditor
          value={content}
          editable={false}
        />

        {sharedLinkId && (
          <section style={{ marginTop: "56px", paddingTop: "28px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
            <p style={{ margin: "0 0 14px 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Have a question about this content?
            </p>
            <Button
              onClick={() => router.push(`/?sharedLinkId=${sharedLinkId}`)}
              icon={<Sparkles size={16} />}
              fullWidth={false}
              className="ask-ai-button"
            >
              Ask a Question
            </Button>
          </section>
        )}

        <footer className="shared-footer" style={{ marginTop: '60px', paddingTop: '40px', borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: '0.9rem' }}>Created with OkBrain AI Assistant</p>
        </footer>
      </div>
    </div>
  );
}
