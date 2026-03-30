import React from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FileExpirationWarning from "./FileExpirationWarning";
import ShellCommandRenderer from "./events/tool-renderers/ShellCommandRenderer";
import { Brain, Search, Globe, Sparkles, Paperclip, AlertTriangle, ThumbsUp, ThumbsDown } from "lucide-react";
import styles from "./ChatMessage.module.css";
import type { Message, FileAttachment, ToolJobData, StreamingTimelineItem } from "./ChatView";
import { markdownComponents, renderOutputSegments } from "./shared/markdown-utils";

interface ChatMessageProps {
    message: Message;
    prevMessage?: Message;
    isFirst: boolean;
    isStreaming: boolean;
    streamingThoughts: string;
    streamingTimeline: StreamingTimelineItem[];
    finalThoughts: string;
    thinkingDuration: number | null;
    expandedThoughts: Set<string>;
    onToggleThoughts: (id: string) => void;
    onFeedback: (messageId: string, feedback: number | null) => void;
    streamingMessageRef?: React.RefObject<HTMLDivElement | null>;
    thoughtsContainerRef?: React.RefObject<HTMLDivElement | null>;
    attachments: FileAttachment[];
    activeToolJobs?: Array<{ toolJobId: string; toolName: string; command?: string; state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout'; sinceSeq: number }>;
}


export default function ChatMessage({
    message,
    prevMessage,
    isFirst,
    isStreaming,
    streamingThoughts,
    streamingTimeline = [],
    finalThoughts,
    thinkingDuration,
    expandedThoughts,
    onToggleThoughts,
    onFeedback,
    streamingMessageRef,
    thoughtsContainerRef,
    attachments,
    activeToolJobs = [],
}: ChatMessageProps) {
    let dateSeparator = null;
    if (message.created_at) {
        const msgDate = new Date(message.created_at + (message.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        const prevDate = prevMessage?.created_at
            ? new Date(prevMessage.created_at + (prevMessage.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
            : null;
        if (isFirst || msgDate !== prevDate) {
            dateSeparator = (
                <div className={`${styles.dateSeparator} ${isFirst ? styles.dateSeparatorFirst : ''}`}>
                    {msgDate}
                </div>
            );
        }
    }

    const durationToShow = thinkingDuration ?? message.thinking_duration;
    const actualThoughtsToShow = message.thoughts || (!isStreaming && finalThoughts ? finalThoughts : undefined);
    const mergedStreamingTimeline = streamingTimeline.reduce<Array<StreamingTimelineItem>>((acc, item) => {
        const text = item.text || "";
        if (!text || item.kind === 'status') return acc;

        const last = acc[acc.length - 1];
        if (last && last.kind === item.kind) {
            last.text += item.text;
            return acc;
        }

        acc.push({
            id: item.id,
            kind: item.kind,
            text: item.text,
        });
        return acc;
    }, []);
    const latestTimelineThoughtId = (() => {
        for (let i = mergedStreamingTimeline.length - 1; i >= 0; i--) {
            if (mergedStreamingTimeline[i].kind === 'thought') {
                return mergedStreamingTimeline[i].id;
            }
        }
        return null;
    })();
    const liveStatusText = (message.status || (message.role === 'summary' ? 'Summarizing' : `Talking to ${message.model?.split(' ')[0] || 'AI'}`))
        .replace(/\.\.\.+$/, '')
        .trim();
    const historicalToolJobs = (message.tool_jobs || []) as ToolJobData[];

    const renderToolCards = () => (
        <>
            {historicalToolJobs.map((toolJob) => {
                let command: string | undefined;
                let output: any = null;
                try {
                    command = toolJob.metadata ? JSON.parse(toolJob.metadata)?.command : undefined;
                } catch { }
                try {
                    output = toolJob.output ? JSON.parse(toolJob.output) : null;
                } catch { }
                return (
                    <ShellCommandRenderer
                        key={toolJob.job_id}
                        toolName={toolJob.tool_name}
                        callContent={{ command }}
                        resultContent={output ? { stdout: output.stdout, stderr: output.stderr, exit_code: output.exitCode, duration_ms: output.durationMs, error: output.error } : undefined}
                        state={toolJob.state}
                        asyncJobId={toolJob.job_id}
                    />
                );
            })}
            {activeToolJobs.map((toolJob) => (
                <ShellCommandRenderer
                    key={toolJob.toolJobId}
                    toolName={toolJob.toolName}
                    callContent={{ command: toolJob.command }}
                    state={toolJob.state}
                    asyncJobId={toolJob.toolJobId}
                    sinceSeq={toolJob.sinceSeq}
                />
            ))}
        </>
    );

    const renderStatusIndicator = (statusText: string, key: string, withDots: boolean) => (
        <div key={key} className={`typing-indicator ${styles.typingIndicatorStyles} ${styles.streamStatusItem}`}>
            <div className={styles.typingIndicatorIcon}>
                {statusText.toLowerCase().includes('search')
                    ? <Search size={14} strokeWidth={2.5} />
                    : statusText
                        ? <Globe size={14} strokeWidth={2.5} />
                        : message.role === 'summary'
                            ? <Sparkles size={14} strokeWidth={2.5} />
                            : <Brain size={14} strokeWidth={2.5} />}
            </div>
            <span className={`message-status ${styles.messageStatusInline}`}>
                {statusText}
                {withDots && (
                    <span className="loading-dots-wrapper">
                        <span className="loading-dot">.</span>
                        <span className="loading-dot">.</span>
                        <span className="loading-dot">.</span>
                    </span>
                )}
            </span>
        </div>
    );

    return (
        <div key={message.id}>
            {dateSeparator}
            <div
                ref={isStreaming ? streamingMessageRef : null}
                className={`message ${message.role} ${isStreaming ? 'streaming' : ''}`}
            >
                <div className="message-content">
                    {message.role === "user" && message.created_at && (
                        <div className={styles.userTimestamp}>
                            {new Date(message.created_at + (message.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </div>
                    )}
                    <div className="message-text">
                        {message.role === "assistant" || message.role === "summary" ? (
                            message.error ? (
                                <div className="chat-error-message">
                                    <AlertTriangle size={16} />
                                    <span>{message.error}</span>
                                </div>
                            ) : (
                                <div className="content-styles">
                                    {renderToolCards()}
                                    {!isStreaming && (() => {
                                        if (!actualThoughtsToShow) return null;
                                        return (
                                            <div className={`thoughts-container ${styles.thoughtsSpacing}`}>
                                                <div
                                                    onClick={() => onToggleThoughts(message.id)}
                                                    className={styles.thoughtForButton}
                                                >
                                                    <Brain size={12} />
                                                    <span>Thought</span>
                                                    <span className={styles.thoughtForArrow}>
                                                        {expandedThoughts.has(message.id) ? '▲' : '▼'}
                                                    </span>
                                                </div>
                                                {expandedThoughts.has(message.id) && (
                                                    <div
                                                        className={`content-styles ${styles.expandedThoughtsPanel} ${styles.expandedThoughtsPanelTall}`}
                                                    >
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {actualThoughtsToShow}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    {isStreaming ? (
                                        <>
                                            {mergedStreamingTimeline.length > 0 ? (
                                            <div className={styles.streamTimeline}>
                                                {mergedStreamingTimeline.map((item, idx) => {
                                                    const isLatestItem = idx === mergedStreamingTimeline.length - 1;
                                                    if (item.kind === 'output') {
                                                        return (
                                                            <div key={item.id} className={styles.streamOutputItem} data-stream-output>
                                                                {renderOutputSegments(item.text, item.id)}
                                                            </div>
                                                        );
                                                    }

                                                    if (item.kind === 'thought') {
                                                        const thoughtToggleId = `${message.id}:thought:${item.id}`;
                                                        const isExpanded = expandedThoughts.has(thoughtToggleId);
                                                        const isLiveThought = isLatestItem;
                                                        return (
                                                            <div key={item.id} className={`thoughts-container ${styles.thoughtsSpacing}`}>
                                                                <div
                                                                    onClick={() => onToggleThoughts(thoughtToggleId)}
                                                                    className={styles.thinkingButton}
                                                                >
                                                                    <Brain size={14} />
                                                                    <span>{isLiveThought ? 'Thinking' : 'Thought'}</span>
                                                                    {isLiveThought && (
                                                                        <span className="loading-dots-wrapper">
                                                                            <span className="loading-dot">.</span>
                                                                            <span className="loading-dot">.</span>
                                                                            <span className="loading-dot">.</span>
                                                                        </span>
                                                                    )}
                                                                    <span className={styles.thinkingArrow}>
                                                                        {isExpanded ? '▲' : '▼'}
                                                                    </span>
                                                                </div>
                                                                {isExpanded && (
                                                                    <div
                                                                        ref={item.id === latestTimelineThoughtId ? thoughtsContainerRef : undefined}
                                                                        className={`content-styles ${styles.expandedThoughtsPanel}`}
                                                                    >
                                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                            {item.text}
                                                                        </ReactMarkdown>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    return null;
                                                })}
                                            </div>
                                        ) : (
                                            <>
                                                {!!message.content && renderOutputSegments(message.content, `${message.id}-fallback-output`)}
                                                {streamingThoughts && (
                                                    <div className={`thoughts-container ${styles.thoughtsSpacing}`}>
                                                        <div
                                                            onClick={() => onToggleThoughts(`${message.id}:fallback-thinking`)}
                                                            className={styles.thinkingButton}
                                                        >
                                                            <Brain size={14} />
                                                            <span>Thinking</span>
                                                            <span className="loading-dots-wrapper">
                                                                <span className="loading-dot">.</span>
                                                                <span className="loading-dot">.</span>
                                                                <span className="loading-dot">.</span>
                                                            </span>
                                                            <span className={styles.thinkingArrow}>
                                                                {expandedThoughts.has(`${message.id}:fallback-thinking`) ? '▲' : '▼'}
                                                            </span>
                                                        </div>
                                                        {expandedThoughts.has(`${message.id}:fallback-thinking`) && (
                                                            <div
                                                                ref={thoughtsContainerRef}
                                                                className={`content-styles ${styles.expandedThoughtsPanel}`}
                                                            >
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                    {streamingThoughts}
                                                                </ReactMarkdown>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                            {renderStatusIndicator(
                                                liveStatusText,
                                                `${message.id}-streaming-status`,
                                                true
                                            )}
                                        </>
                                    ) : (
                                        renderOutputSegments(message.content, message.id)
                                    )}
                                </div>
                            )
                        ) : (
                            <>
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={markdownComponents}
                                >
                                    {message.content}
                                </ReactMarkdown>
                                {(() => {
                                    const msgAttachments = message.attachments || [];
                                    const imageAttachments = msgAttachments.filter(a => a.mime_type.startsWith('image/'));
                                    const nonImageCount = (message.fileCount ?? msgAttachments.length) - imageAttachments.length;
                                    if (imageAttachments.length === 0 && nonImageCount <= 0) return null;
                                    return (
                                        <>
                                            {imageAttachments.length > 0 && (
                                                <div className="message-image-attachments">
                                                    {imageAttachments.map((a, i) => (
                                                        <img
                                                            key={i}
                                                            src={a.uri}
                                                            alt={a.name}
                                                            className="message-image-thumbnail"
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                            {nonImageCount > 0 && (
                                                <div className="message-meta">
                                                    <div className="message-file-badge">
                                                        <Paperclip size={14} /> {nonImageCount} file{nonImageCount > 1 ? 's' : ''}
                                                    </div>
                                                    <FileExpirationWarning
                                                        messageId={message.id}
                                                        role={message.role}
                                                        attachments={attachments}
                                                    />
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </>
                        )}
                        {message.role === "assistant" && !isStreaming && (() => {
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

                        {message.role === "assistant" && !isStreaming && !message.error && (
                            <div className={`message-feedback ${styles.feedbackContainer}`}>
                                <button
                                    onClick={() => onFeedback(message.id, message.feedback === 1 ? null : 1)}
                                    className={`feedback-btn ${message.feedback === 1 ? `active ${styles.feedbackButtonActive}` : ''} ${styles.feedbackButton}`}
                                    title="Good response"
                                >
                                    <ThumbsUp size={14} strokeWidth={message.feedback === 1 ? 2.5 : 2} />
                                </button>
                                <button
                                    onClick={() => onFeedback(message.id, message.feedback === -1 ? null : -1)}
                                    className={`feedback-btn ${message.feedback === -1 ? `active ${styles.feedbackButtonActive}` : ''} ${styles.feedbackButton}`}
                                    title="Bad response"
                                >
                                    <ThumbsDown size={14} strokeWidth={message.feedback === -1 ? 2.5 : 2} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
