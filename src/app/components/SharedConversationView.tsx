"use client";

import { useRouter } from "next/navigation";
import React, { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import ImageGallery, { SingleImage, parseImageBlocks } from "./ImageGallery";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { FileText, Globe, Sparkles } from "lucide-react";
import { Button } from "./primitive/Button";
import "./primitive/ContentStyles.module.css";
import "./Markdown.module.css";
import "./ChatLayout.module.css";
import "highlight.js/styles/vs2015.css";

interface Message {
  id: string;
  role: "user" | "assistant" | "summary";
  content: string;
  model?: string;
  sources?: string;
  wasGrounded?: boolean;
  thoughts?: string;
  thinking_duration?: number;
  created_at?: string;
}

interface SharedConversationViewProps {
  title: string;
  messages: Message[];
  sharedLinkId?: string;
  linkedSharedLinks?: { sharedLinkId: string; title: string }[];
}

const LONG_TOKEN_LENGTH = 56;
const TRUNCATED_TOKEN_LENGTH = 44;
const DOMAIN_LABEL_MAX = 20;

function getTextFromChildren(children: ReactNode): string {
  const childList = Array.isArray(children) ? children : [children];
  return childList
    .map((child) => (typeof child === 'string' || typeof child === 'number') ? String(child) : '')
    .join('')
    .trim();
}

function truncateToken(token: string, maxLength = TRUNCATED_TOKEN_LENGTH): string {
  if (token.length <= maxLength) return token;
  return `${token.slice(0, maxLength - 1)}…`;
}

function getUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function unescapeContent(content: string): string {
  return content
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
}

function replaceYieldNotesWithBreaks(content: string): string {
  return unescapeContent(content)
    .replace(/(?:\r?\n)?<yeild>[\s\S]*?<\/yeild>(?:\r?\n)?/ig, '\n\n')
    .replace(/(?:\r?\n)?<yeild>[\s\S]*?<\/yield>(?:\r?\n)?/ig, '\n\n')
    .replace(/(?:\r?\n)?<yeild>[\s\S]*$/ig, '\n\n')
    .replace(/<\/yeild>/ig, '')
    .replace(/<\/yield>/ig, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function SharedConversationView({ title, messages, sharedLinkId, linkedSharedLinks }: SharedConversationViewProps) {
  const router = useRouter();
  const markdownComponents: any = {
    ul: ({ ...props }: any) => <ul className="markdown-list" {...props} />,
    ol: ({ ...props }: any) => <ol className="markdown-list" {...props} />,
    li: ({ children, ...props }: any) => <li className="markdown-list-item" {...props}>{children}</li>,
    p: ({ ...props }: any) => <p className="markdown-paragraph" {...props} />,
    strong: ({ ...props }: any) => <strong className="markdown-strong" {...props} />,
    code: ({ inline, children, ...props }: any) => {
      if (!inline) {
        return <code className="markdown-code" {...props}>{children}</code>;
      }
      const text = getTextFromChildren(children);
      const isLongToken = text.length > LONG_TOKEN_LENGTH;
      return (
        <code
          className={`markdown-inline-code ${isLongToken ? 'markdown-long-token' : ''}`}
          title={isLongToken ? text : undefined}
          {...props}
        >
          {isLongToken ? truncateToken(text) : children}
        </code>
      );
    },
    pre: ({ ...props }: any) => <pre className="markdown-pre" {...props} />,
    table: ({ ...props }: any) => <div className="markdown-table-wrapper"><table className="markdown-table" {...props} /></div>,
    thead: ({ ...props }: any) => <thead className="markdown-thead" {...props} />,
    tbody: ({ ...props }: any) => <tbody className="markdown-tbody" {...props} />,
    tr: ({ ...props }: any) => <tr className="markdown-tr" {...props} />,
    th: ({ ...props }: any) => <th className="markdown-th" {...props} />,
    td: ({ ...props }: any) => <td className="markdown-td" {...props} />,
    hr: ({ ...props }: any) => <hr className="markdown-hr" {...props} />,
    a: ({ children, href, ...props }: any) => {
      const text = getTextFromChildren(children);
      const isCitation = /^\[\d+\]$/.test(text) || /^\d+$/.test(text) || text === 'source' || text === '[source]';
      if (isCitation) {
        return (
          <a
            target="_blank"
            rel="noopener noreferrer"
            className="markdown-citation"
            href={href}
            {...props}
          >
            {text.replace(/[\[\]]/g, "")}
          </a>
        );
      }

      const linkText = text || href || '';
      const isRawUrlLink = Boolean(href) && linkText === href;
      const compactLabel = isRawUrlLink
        ? truncateToken(getUrlDomain(href), DOMAIN_LABEL_MAX)
        : truncateToken(linkText);

      return (
        <a
          target="_blank"
          rel="noopener noreferrer"
          className={isRawUrlLink ? "markdown-link markdown-link-domain" : "markdown-link"}
          href={href}
          title={linkText || href}
          {...props}
        >
          <span className="markdown-link-label">
            {compactLabel}
          </span>
        </a>
      );
    },
  };

  return (
    <div className="messages-container" style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
      <div className="messages-wrapper" style={{ maxWidth: '700px', margin: '0 auto', padding: '60px 20px' }}>
        <style jsx global>{`
          @media print {
            .shared-header, .shared-footer {
              display: none !important;
            }
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
            /* Target the Next.js main wrapper in shared page */
            main {
              height: auto !important;
              overflow: visible !important;
              display: block !important;
            }
            .messages-container {
              background: white !important;
              min-height: 0 !important;
              height: auto !important;
              overflow: visible !important;
              display: block !important;
              padding: 0 !important;
            }
            .messages-wrapper {
              padding: 0 !important;
              margin: 0 !important;
              max-width: 100% !important;
              width: 100% !important;
              display: block !important;
            }
            .message-text {
              break-inside: avoid;
            }
            
            /* Hide thoughts in print */
            .thoughts-container {
              display: none !important;
            }
            
            /* Show model name in print and style it */
            .model-tag {
              display: block !important;
              color: #444 !important;
              font-size: 0.65rem !important;
              border: 1px solid #ddd !important;
              border-radius: 4px !important;
              padding: 2px 8px !important;
              margin-bottom: 8px !important;
              width: fit-content !important;
              background-color: transparent !important;
            }
            
            /* Style summary section in print */
            .message.summary {
              background-color: #eee !important;
              border: 1px solid #ddd !important;
              border-radius: 8px !important;
              padding: 16px !important;
              margin-bottom: 24px !important;
              box-shadow: none !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              display: block !important;
            }
            
            .message.summary .message-content,
            .message.summary .message-text,
            .message.summary .content-styles {
              background: transparent !important;
              box-shadow: none !important;
              border: none !important;
              padding: 0 !important;
            }
            
            .message.summary::before {
              content: "SUMMARY";
              font-size: 0.7rem;
              font-weight: bold;
              color: #888;
              display: block;
              margin-bottom: 8px;
            }
          }
        `}</style>

        <header className="shared-header" style={{ marginBottom: '48px', textAlign: 'center', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--accent-cyan)', marginBottom: '16px' }}>
            <Globe size={18} />
            <span style={{ fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.7rem', opacity: 0.8 }}>Publicly Shared Chat</span>
          </div>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1.2, color: 'var(--text-primary)', letterSpacing: '-0.02em', padding: '0 40px' }}>{title}</h1>
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

        {linkedSharedLinks && linkedSharedLinks.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.6, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              Based on
            </div>
            {linkedSharedLinks.map((link) => (
              <div
                key={link.sharedLinkId}
                className="document-context-card"
                onClick={() => router.push(`/s/${link.sharedLinkId}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 18px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-cyan, var(--border-hover))';
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '38px',
                  height: '38px',
                  borderRadius: '9px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  flexShrink: 0,
                }}>
                  <FileText size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Shared Content</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{link.title}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="shared-messages-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {messages.map((message, idx) => {
            const isSummary = message.role === 'summary';
            const renderableContent = (message.role === 'assistant' || isSummary)
              ? replaceYieldNotesWithBreaks(message.content)
              : message.content;
            // Find model name from the next assistant/summary message
            let modelName: string | undefined;
            if (message.role === 'user') {
              for (let j = idx + 1; j < messages.length; j++) {
                if ((messages[j].role === 'assistant' || messages[j].role === 'summary') && messages[j].model) {
                  modelName = messages[j].model;
                  break;
                }
                if (messages[j].role === 'user') break;
              }
            }
            // Date separator
            let dateSeparator: React.ReactNode = null;
            if (message.created_at) {
              const msgDate = new Date(message.created_at + (message.created_at.endsWith('Z') ? '' : 'Z'))
                .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
              const prevMsg = idx > 0 ? messages[idx - 1] : undefined;
              const prevDate = prevMsg?.created_at
                ? new Date(prevMsg.created_at + (prevMsg.created_at.endsWith('Z') ? '' : 'Z'))
                    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                : null;
              if (idx === 0 || msgDate !== prevDate) {
                dateSeparator = (
                  <div style={{
                    textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)',
                    opacity: 0.5, marginTop: idx === 0 ? 0 : '24px', marginBottom: '16px',
                  }}>
                    {msgDate}
                  </div>
                );
              }
            }

            // Timestamp for user messages
            const timestamp = message.role === 'user' && message.created_at
              ? new Date(message.created_at + (message.created_at.endsWith('Z') ? '' : 'Z'))
                  .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
              : null;

            return (
              <React.Fragment key={message.id}>
              {dateSeparator}
              <div
                className={`message ${message.role}`}
              >
                <div className="message-content">
                  {timestamp && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.5 }}>{timestamp}</span>
                    </div>
                  )}
                  <div className="message-text">
                    {(message.role === "assistant" || isSummary) ? (
                      <div className="content-styles" style={{ width: '100%' }}>

                        <div style={{ color: isSummary ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                          {parseImageBlocks(renderableContent).map((segment, segIdx) =>
                            segment.type === 'images' ? (
                              <ImageGallery key={segIdx} images={segment.images} loading={segment.loading} />
                            ) : segment.type === 'single-image' ? (
                              <SingleImage key={segIdx} src={segment.src} alt={segment.alt} width={segment.width} />
                            ) : (
                              <ReactMarkdown
                                key={segIdx}
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeHighlight]}
                                urlTransform={(url) => url}
                                components={markdownComponents}
                              >
                                {segment.content}
                              </ReactMarkdown>
                            )
                          )}
                        </div>


                        {(() => {
                          if (!message.sources) return null;
                          try {
                            const sources = typeof message.sources === 'string'
                              ? JSON.parse(message.sources)
                              : message.sources;
                            if (Array.isArray(sources) && sources.length > 0) {
                              return (
                                <div className="message-sources">
                                  <div className="message-sources-list">
                                    {sources.map((source: any, idx: number) => {
                                      const url = source.uri || '';
                                      let domain = '';
                                      try {
                                        if (url) domain = new URL(url).hostname.replace('www.', '');
                                      } catch (e) { }

                                      const displayText = (source.title && !/^\d+$/.test(source.title.trim()))
                                        ? source.title
                                        : (domain || url || `Source ${idx + 1}`);

                                      return (
                                        <a
                                          key={idx}
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="message-source-link"
                                          title={source.title || url}
                                        >
                                          <span className="message-source-text">
                                            {displayText}
                                          </span>
                                        </a>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          } catch (e) {
                            return null;
                          }
                        })()}
                      </div>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              </div>
              {modelName && (
                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  opacity: 0.7,
                  fontWeight: 500,
                }}>
                  {modelName}
                </div>
              )}
              </React.Fragment>
            );
          })}
        </div>

        {sharedLinkId && (
          <section style={{ marginTop: "56px", paddingTop: "28px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
            <p style={{ margin: "0 0 14px 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Have a question about this conversation?
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
      </div>
      <footer className="shared-footer" style={{ marginTop: '60px', paddingTop: '40px', borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '0.9rem' }}>Created with OkBrain AI Assistant</p>
      </footer>
    </div>
  );
}
