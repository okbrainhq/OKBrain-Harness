"use client";

import React from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, Search, Globe, Sparkles } from "lucide-react";
import { renderOutputSegments } from "../shared/markdown-utils";
import styles from "./EventRenderer.module.css";

interface StreamingTailProps {
    streamingText: string;
    streamingThoughts: string;
    streamingStatus: string;
    expandedThoughts: Set<string>;
    onToggleThoughts: (id: string) => void;
    thoughtsContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export default function StreamingTail({
    streamingText,
    streamingThoughts,
    streamingStatus,
    expandedThoughts,
    onToggleThoughts,
    thoughtsContainerRef,
}: StreamingTailProps) {
    const hasContent = streamingText || streamingThoughts || streamingStatus;
    if (!hasContent) return null;

    const thoughtToggleId = 'streaming-thought-live';
    const isThoughtExpanded = expandedThoughts.has(thoughtToggleId);

    return (
        <div className="message assistant streaming">
            <div className="message-content">
                <div className="message-text">
                    <div className="content-styles">
                        {/* Streaming thoughts */}
                        {streamingThoughts && (
                            <div className={`thoughts-container ${styles.thoughtsSpacing}`}>
                                <div
                                    onClick={() => onToggleThoughts(thoughtToggleId)}
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
                                        {isThoughtExpanded ? '▲' : '▼'}
                                    </span>
                                </div>
                                {isThoughtExpanded && (
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

                        {/* Streaming text */}
                        {streamingText && (
                            <div className={styles.streamOutputItem} data-streaming-output>
                                {renderOutputSegments(streamingText, 'streaming-tail')}
                            </div>
                        )}

                        {/* Status indicator */}
                        {streamingStatus && (
                            <div className={`typing-indicator ${styles.typingIndicatorStyles}`}>
                                <div className={styles.typingIndicatorIcon}>
                                    {streamingStatus.toLowerCase().includes('search')
                                        ? <Search size={14} strokeWidth={2.5} />
                                        : streamingStatus.toLowerCase().includes('waiting')
                                            ? <Sparkles size={14} strokeWidth={2.5} />
                                            : <Globe size={14} strokeWidth={2.5} />}
                                </div>
                                <span className={`message-status ${styles.messageStatusInline}`}>
                                    {streamingStatus.replace(/\.\.\.+$/, '').trim()}
                                    <span className="loading-dots-wrapper">
                                        <span className="loading-dot">.</span>
                                        <span className="loading-dot">.</span>
                                        <span className="loading-dot">.</span>
                                    </span>
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
