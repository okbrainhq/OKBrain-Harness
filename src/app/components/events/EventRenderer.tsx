"use client";

import React, { useCallback, useState } from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, Search, Globe, Sparkles, AlertTriangle, ThumbsUp, ThumbsDown, Wrench, Check, X, PackageOpen, StopCircle } from "lucide-react";
import { markdownComponents, renderOutputSegments } from "../shared/markdown-utils";
import { ImageModal } from "../ImageGallery";
import { getToolRenderer } from "./tool-renderers";
import "./tool-renderers/register";
import type { ParsedChatEvent } from "@/hooks/useEventChatStreaming";
import styles from "./EventRenderer.module.css";

interface EventRendererProps {
    event: ParsedChatEvent;
    conversationId: string;
    expandedThoughts: Set<string>;
    onToggleThoughts: (id: string) => void;
    onFeedback: (eventId: string, feedback: number | null) => void;
    isFirst: boolean;
    prevEvent?: ParsedChatEvent;
    // For tool_call/result pairing
    pairedToolResult?: ParsedChatEvent;
    activeToolJobs: Array<{ toolJobId: string; toolName: string; command?: string; callId?: string; state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout'; sinceSeq: number }>;
    // Consecutive thought events grouped together
    thoughtGroup?: ParsedChatEvent[];
    // Model name to show on user messages
    modelName?: string;
}

function UserMessageEvent({ event, content, dateSeparator, modelName }: {
    event: ParsedChatEvent;
    content: any;
    dateSeparator: React.ReactNode;
    modelName?: string;
}) {
    const [selectedImage, setSelectedImage] = useState<{ src: string; title: string } | null>(null);
    const timestamp = event.created_at
        ? new Date(event.created_at + (event.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : null;
    const allAttachments = Array.isArray(content.attachments) ? content.attachments : [];
    const imageAttachments = allAttachments.filter((a: any) => a.mime_type?.startsWith('image/'));
    // Local file URIs (e.g. /uploads/...) can be displayed as images; remote URIs (e.g. Google File API) cannot
    const localImages = imageAttachments.filter((a: any) => a.uri?.startsWith('/'));
    const remoteFileCount = allAttachments.filter((a: any) => !a.uri?.startsWith('/')).length;

    return (
        <>
            {dateSeparator}
            <div className="message user">
                <div className="message-content">
                    {timestamp && (
                        <div className={styles.userMeta}>
                            <span className={styles.userTimestamp}>{timestamp}</span>
                        </div>
                    )}
                    <div className="message-text">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                        >
                            {content.text || ''}
                        </ReactMarkdown>
                        {localImages.length > 0 && (
                            <div className="message-image-attachments">
                                {localImages.map((a: any, i: number) => (
                                    <button
                                        key={i}
                                        type="button"
                                        className="message-image-thumbnail-btn"
                                        onClick={() => setSelectedImage({ src: a.uri, title: a.name || 'Image' })}
                                    >
                                        <img
                                            src={a.uri}
                                            alt={a.name}
                                            className="message-image-thumbnail"
                                        />
                                    </button>
                                ))}
                            </div>
                        )}
                        {remoteFileCount > 0 && (
                            <div className={styles.fileAttachedBanner}>
                                {remoteFileCount === 1 ? '1 file attached' : `${remoteFileCount} files attached`}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {modelName && (
                <div className={`model-tag ${styles.modelTag}`}>
                    {modelName}
                </div>
            )}
            {selectedImage && (
                <ImageModal
                    selectedImage={selectedImage}
                    onClose={() => setSelectedImage(null)}
                />
            )}
        </>
    );
}

export default function EventRenderer({
    event,
    conversationId,
    expandedThoughts,
    onToggleThoughts,
    onFeedback,
    isFirst,
    prevEvent,
    pairedToolResult,
    activeToolJobs,
    thoughtGroup,
    modelName,
}: EventRendererProps) {
    const { kind, content } = event;

    // Date separator
    let dateSeparator = null;
    if (event.created_at) {
        const msgDate = new Date(event.created_at + (event.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const prevDate = prevEvent?.created_at
            ? new Date(prevEvent.created_at + (prevEvent.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : null;
        if (isFirst || msgDate !== prevDate) {
            dateSeparator = (
                <div className={`${styles.dateSeparator} ${isFirst ? styles.dateSeparatorFirst : ''}`}>
                    {msgDate}
                </div>
            );
        }
    }

    if (kind === 'user_message') {
        return (
            <UserMessageEvent
                event={event}
                content={content}
                dateSeparator={dateSeparator}
                modelName={modelName}
            />
        );
    }

    if (kind === 'assistant_text') {
        // Strip yield tags from text
        const rawText = content.text || '';
        const cleanText = rawText
            .replace(/<yeild>[\s\S]*?<\/yeild>/ig, "")
            .replace(/<yeild>[\s\S]*?<\/yield>/ig, "")
            .replace(/<yeild>[\s\S]*$/ig, "")
            .replace(/<\/yeild>/ig, "")
            .replace(/<\/yield>/ig, "")
            .trim();

        // Skip events that were only yield tags
        if (!cleanText) return null;

        return (
            <>
                {dateSeparator}
                <div className="message assistant">
                    <div className="message-content">
                        <div className="message-text">
                            <div className="content-styles">
                                {renderOutputSegments(cleanText, `evt-${event.id}`)}
                            </div>
                            {!event.id.startsWith('temp-') && (
                                <div className={`message-feedback ${styles.feedbackContainer}`}>
                                    <button
                                        onClick={() => onFeedback(event.id, event.feedback === 1 ? null : 1)}
                                        className={`feedback-btn ${event.feedback === 1 ? `active ${styles.feedbackButtonActive}` : ''} ${styles.feedbackButton}`}
                                        title="Good response"
                                    >
                                        <ThumbsUp size={14} strokeWidth={event.feedback === 1 ? 2.5 : 2} />
                                    </button>
                                    <button
                                        onClick={() => onFeedback(event.id, event.feedback === -1 ? null : -1)}
                                        className={`feedback-btn ${event.feedback === -1 ? `active ${styles.feedbackButtonActive}` : ''} ${styles.feedbackButton}`}
                                        title="Bad response"
                                    >
                                        <ThumbsDown size={14} strokeWidth={event.feedback === -1 ? 2.5 : 2} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    }

    if (kind === 'thought') {
        const thoughts = thoughtGroup || [event];
        const thoughtToggleId = `thought-group-${thoughts[0].id}`;
        const isExpanded = expandedThoughts.has(thoughtToggleId);
        const combinedText = thoughts.map(t => t.content?.text || '').filter(Boolean).join('\n\n');
        return (
            <div className={`thoughts-container ${styles.thoughtsSpacing}`}>
                <div
                    onClick={() => onToggleThoughts(thoughtToggleId)}
                    className={styles.thoughtForButton}
                >
                    <Brain size={12} />
                    <span>Thought</span>
                    <span className={styles.thoughtForArrow}>
                        {isExpanded ? '▲' : '▼'}
                    </span>
                </div>
                {isExpanded && (
                    <div className={`content-styles ${styles.expandedThoughtsPanel}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {combinedText}
                        </ReactMarkdown>
                    </div>
                )}
            </div>
        );
    }

    if (kind === 'tool_call') {
        const toolName = content.tool_name;
        const callId = content.call_id;

        // Find active tool job by callId
        const activeJob = callId
            ? activeToolJobs.find(j => j.callId === callId)
            : undefined;

        // Determine status from paired result
        let initialState: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout' = 'running';
        if (pairedToolResult) {
            const status = pairedToolResult.content.status;
            if (status === 'success') initialState = 'succeeded';
            else if (status === 'error') initialState = 'failed';
            else if (status === 'yield') initialState = 'running';
            else if (status === 'timeout') initialState = 'timeout';
            else if (status === 'cancelled') initialState = 'stopped';
        } else if (activeJob) {
            initialState = activeJob.state;
        }

        // Check for a custom renderer
        const CustomRenderer = getToolRenderer(toolName);
        if (CustomRenderer) {
            return (
                <div className="tool-call-container">
                    <CustomRenderer
                        toolName={toolName}
                        callContent={content}
                        resultContent={pairedToolResult?.content}
                        state={initialState}
                        asyncJobId={activeJob?.toolJobId || pairedToolResult?.content?.async_job_id || pairedToolResult?.content?.job_id}
                        sinceSeq={activeJob?.sinceSeq}
                    />
                </div>
            );
        }

        // For inline tools, show a simple card
        const isDone = initialState === 'succeeded' || initialState === 'failed' || initialState === 'stopped' || initialState === 'timeout';
        const hasFailed = initialState === 'failed';
        return (
            <div className="tool-call-container">
                <div className={styles.inlineToolCard}>
                    <span className={`${styles.inlineToolIcon} ${!isDone ? styles.inlineToolIconRunning : ''}`}>
                        {isDone ? (
                            hasFailed ? <X size={14} strokeWidth={2.5} /> : <Check size={14} strokeWidth={2.5} />
                        ) : (
                            <Wrench size={14} />
                        )}
                    </span>
                    <div className={styles.inlineToolName}>
                        {isDone ? `Called tool: ${toolName}` : `Calling tool: ${toolName}`}
                    </div>
                </div>
            </div>
        );
    }

    // Skip tool_result - it's rendered paired with tool_call
    if (kind === 'tool_result') {
        return null;
    }

    if (kind === 'sources') {
        const items = content.items;
        if (!Array.isArray(items) || items.length === 0) return null;
        return (
            <div className="message-sources">
                <div className="message-sources-list">
                    {items.map((source: any, idx: number) => {
                        const url = source.uri || source.url || '';
                        let domain = '';
                        try { if (url) domain = new URL(url).hostname.replace('www.', ''); } catch { }
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
                                <span className="message-source-text">{displayText}</span>
                            </a>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (kind === 'compaction') {
        const compactToggleId = `compaction-${event.id}`;
        const isExpanded = expandedThoughts.has(compactToggleId);
        const tokensBefore = content.tokensBefore ? ` (${Number(content.tokensBefore).toLocaleString()} tokens)` : '';
        return (
            <>
                {dateSeparator}
                <div className={`thoughts-container ${styles.thoughtsSpacing}`}>
                    <div
                        onClick={() => onToggleThoughts(compactToggleId)}
                        className={styles.thoughtForButton}
                    >
                        <PackageOpen size={12} />
                        <span>Context compacted{tokensBefore}</span>
                        <span className={styles.thoughtForArrow}>
                            {isExpanded ? '▲' : '▼'}
                        </span>
                    </div>
                    {isExpanded && (
                        <div className={`content-styles ${styles.expandedThoughtsPanel}`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {content.text || ''}
                            </ReactMarkdown>
                        </div>
                    )}
                </div>
            </>
        );
    }

    if (kind === 'stopped') {
        return (
            <>
                {dateSeparator}
                <div className={`thoughts-container ${styles.thoughtsSpacing}`}>
                    <div className={styles.thoughtForButton} style={{ cursor: 'default' }}>
                        <StopCircle size={12} />
                        <span>User cancelled</span>
                    </div>
                </div>
            </>
        );
    }

    if (kind === 'summary') {
        return (
            <>
                {dateSeparator}
                <div className="message summary">
                    <div className="message-content">
                        <div className="message-text">
                            <div className="content-styles">
                                {content.model && (
                                    <div className={`model-tag ${styles.modelTag}`}>
                                        {content.model}
                                    </div>
                                )}
                                {renderOutputSegments(content.text || '', `evt-${event.id}`)}
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // Unknown event kind — skip
    return null;
}
