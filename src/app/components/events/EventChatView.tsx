"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChatContext } from "../../context/ChatContext";
import { FileText, AppWindow } from "lucide-react";

import MoveToFolderModal from "../MoveToFolderModal";
import ShareModal from "../ShareModal";
import ChatHeader from "../ChatHeader";
import ChatEmptyState from "../ChatEmptyState";
import ChatActions from "../ChatActions";
import EventRenderer from "./EventRenderer";
import StreamingTail from "./StreamingTail";

import { useEventChatStreaming, type ParsedChatEvent, type YieldedToolJob } from "@/hooks/useEventChatStreaming";

import chatStyles from "../ChatView.module.css";
import "../primitive/ContentStyles.module.css";
import "../Markdown.module.css";
import "highlight.js/styles/vs2015.css";

interface EventChatViewProps {
    initialConversationId?: string;
    initialEvents?: ParsedChatEvent[];
    initialConversation?: any;
    initialActiveJobId?: string | null;
    initialLastJobSeq?: number;
    initialStreamingContent?: string;
    initialStreamingThoughts?: string;
    initialStreamingStatus?: string;
    initialYieldWaiting?: boolean;
    initialYieldedToolJobs?: YieldedToolJob[];
    initialVerifyModel?: string | null;
    initialDocumentContexts?: { id: string; title: string }[] | null;
    initialContentContexts?: { title: string; content: string; sharedLinkId?: string }[] | null;
    initialAppId?: string | null;
    initialAppContext?: { id: string; title: string } | null;
    initialHighlightsData?: any;
}

export default function EventChatView({
    initialConversationId = '',
    initialEvents = [],
    initialConversation = null,
    initialActiveJobId = null,
    initialLastJobSeq = 0,
    initialStreamingContent = '',
    initialStreamingThoughts = '',
    initialStreamingStatus = '',
    initialYieldWaiting = false,
    initialYieldedToolJobs = [],
    initialVerifyModel = null,
    initialDocumentContexts = [],
    initialContentContexts = [],
    initialAppId = null,
    initialAppContext = null,
    initialHighlightsData = null,
}: EventChatViewProps) {
    const {
        modelsConfig,
        setConversations, defaultFolderId, folders, moveConversationToFolder,
        input, setInput, isLoading, setIsLoading, isCancelling, setIsCancelling, thinking, responseMode, setResponseMode, aiProvider, setAiProvider, sendMessageRef,
        stopStreamingRef, focusInputRef,
        imageAttachment, clearImageAttachment,
        fileAttachments, clearFileAttachments,
        yieldedToolJobs, setYieldedToolJobs,
        conversations,
        location: locationContext,
        setDeleteConfirm, setRenameConfirm,
    } = useChatContext();

    const router = useRouter();
    const searchParams = useSearchParams();

    const [documentContexts, setDocumentContexts] = useState<{ id: string; title: string }[]>(initialDocumentContexts || []);
    const [contentContexts, setContentContexts] = useState<{ title: string; content: string; sharedLinkId?: string }[]>(initialContentContexts || []);
    const [showMenu, setShowMenu] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false);
    const [showVerifyMenu, setShowVerifyMenu] = useState(false);
    const [verifyModel, setVerifyModel] = useState<string>(initialVerifyModel || 'xai');
    const [lastOpenedItem, setLastOpenedItem] = useState<{ type: string; id: string } | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const thoughtsContainerRef = useRef<HTMLDivElement>(null);

    const {
        events,
        setEvents,
        streamingText,
        streamingThoughts,
        streamingStatus,
        activeJobId,
        activeToolJobs,
        expandedThoughts,
        setExpandedThoughts,
        errorMessage,
        conversationId,
        conversation,
        setConversation,
        sendMessage,
    } = useEventChatStreaming({
        conversationId: initialConversationId,
        initialEvents,
        initialConversation,
        initialActiveJobId,
        initialLastJobSeq,
        initialStreamingContent,
        initialStreamingThoughts,
        initialStreamingStatus,
        initialYieldWaiting,
        initialYieldedToolJobs,
        modelsConfig,
        setConversations,
        input, setInput,
        isLoading, setIsLoading,
        isCancelling, setIsCancelling,
        thinking, responseMode: responseMode as 'quick' | 'detailed',
        aiProvider, defaultFolderId,
        imageAttachment, clearImageAttachment,
        fileAttachments, clearFileAttachments,
        yieldedToolJobs, setYieldedToolJobs,
        documentContexts, contentContexts, locationContext,
        appId: initialAppId,
        sendMessageRef, stopStreamingRef, focusInputRef,
    });

    // Initialize conversation settings (only when values differ to avoid loops)
    useEffect(() => {
        if (initialConversation) {
            if (initialConversation.ai_provider && initialConversation.ai_provider !== aiProvider) {
                setAiProvider(initialConversation.ai_provider);
            }
            if (initialConversation.response_mode && initialConversation.response_mode !== responseMode) {
                setResponseMode(initialConversation.response_mode as 'quick' | 'detailed');
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialConversation]);

    // Sync local conversation state when context conversations list is updated (e.g., after rename)
    useEffect(() => {
        if (!conversation || !conversationId) return;
        const updated = conversations.find((c: any) => c.id === conversationId);
        if (updated && updated.title !== conversation.title) {
            setConversation((prev: any) => prev ? { ...prev, title: updated.title } : prev);
        }
    }, [conversations, conversationId]);

    // Save scroll position
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || !conversationId) return;
        let timeout: NodeJS.Timeout;
        const handleScroll = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                localStorage.setItem(`scrollPos:chat:${conversationId}`, String(container.scrollTop));
            }, 300);
        };
        container.addEventListener('scroll', handleScroll);
        return () => {
            clearTimeout(timeout);
            container.removeEventListener('scroll', handleScroll);
        };
    }, [conversationId]);

    // Restore scroll position or scroll to bottom
    useEffect(() => {
        if (events.length > 0) {
            if (searchParams.get('restoreScroll') === 'true' && conversationId) {
                const savedPos = localStorage.getItem(`scrollPos:chat:${conversationId}`);
                if (savedPos) {
                    setTimeout(() => {
                        const container = messagesContainerRef.current;
                        if (container) container.scrollTop = parseInt(savedPos, 10);
                    }, 100);
                }
            } else if (searchParams.get('scroll') === 'true') {
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
                }, 100);
            }
        }
    }, [events.length > 0, conversationId, searchParams]);

    // Track lastOpenedItem
    useEffect(() => {
        try {
            const saved = localStorage.getItem('lastOpenedItem');
            if (saved) setLastOpenedItem(JSON.parse(saved));
        } catch { }
    }, []);

    useEffect(() => {
        if (conversationId) {
            const item = { type: 'chat', id: conversationId };
            localStorage.setItem('lastOpenedItem', JSON.stringify(item));
            setLastOpenedItem(item);
        }
    }, [conversationId]);

    // Build tool_call -> tool_result map for pairing
    const toolResultMap = new Map<string, ParsedChatEvent>();
    for (const evt of events) {
        if (evt.kind === 'tool_result' && evt.content?.call_id) {
            toolResultMap.set(evt.content.call_id, evt);
        }
    }

    // Feedback handler
    const handleFeedback = useCallback(async (eventId: string, feedback: number | null) => {
        setEvents(prev => prev.map(e =>
            e.id === eventId ? { ...e, feedback } : e
        ));
        try {
            const res = await fetch(`/api/conversations/${conversationId}/events/${eventId}/feedback`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ feedback }),
            });
            if (!res.ok) throw new Error("Failed to save feedback");
        } catch {
            // Revert on error
            setEvents(prev => prev.map(e =>
                e.id === eventId ? { ...e, feedback: events.find(ev => ev.id === eventId)?.feedback } : e
            ));
        }
    }, [conversationId, events, setEvents]);

    const handleVerifyModelChange = useCallback((model: string) => {
        setVerifyModel(model);
        fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'verify:model', value: model }),
        }).catch(() => { });
    }, []);

    const handleVerify = () => {
        sendMessage({ message: "Can you verify", provider: verifyModel, skipProviderUpdate: true, thinking: true });
    };

    const handleSummarize = () => {
        sendMessage({ message: "Summarize this conversation", provider: 'gemini', skipProviderUpdate: true, endpoint: "/api/summarize" });
    };

    const handleOpenLast = () => {
        const saved = localStorage.getItem('lastOpenedItem');
        if (saved) {
            try {
                const item = JSON.parse(saved);
                if (item.type === 'chat' && item.id) {
                    router.push(`/chat/${item.id}?restoreScroll=true`);
                    return;
                }
                if (item.type === 'doc' && item.id) {
                    router.push(`/doc/${item.id}?restoreScroll=true`);
                    return;
                }
            } catch { }
        }
        if (conversations.length > 0) {
            const latest = [...conversations].sort((a: any, b: any) =>
                new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
            )[0];
            router.push(`/chat/${(latest as any).id}?scroll=true`);
        }
    };

    const handleTodayNews = () => {
        if (isLoading) return;
        sendMessage({ message: "Analyze the top 10 most impactful global news stories from today from diverse credible sources. For each story, provide a clear headline and a concise 1-2 sentence summary. Prioritize major geopolitical, technological, and scientific developments. Also, please check my personal context/memory and include any major news that is specifically relevant to me." });
    };

    const handlePrint = () => {
        setShowMenu(false);
        window.print();
    };

    const renderDocumentContext = () => {
        if (!documentContexts || documentContexts.length === 0) return null;
        return documentContexts.map(doc => (
            <div
                key={doc.id}
                className={`document-context-card ${chatStyles.documentContextCard}`}
                onClick={() => router.push(`/doc/${doc.id}`)}
            >
                <div className={chatStyles.documentContextIcon}><FileText size={20} /></div>
                <div className={chatStyles.documentContextContent}>
                    <div className={chatStyles.documentContextLabel}>Document Context</div>
                    <div className={chatStyles.documentContextTitle}>{doc.title}</div>
                </div>
            </div>
        ));
    };

    const renderContentContext = () => {
        if (!contentContexts || contentContexts.length === 0) return null;
        return contentContexts
            .filter(ctx => !(initialAppContext && ctx.title.startsWith('App: ')))
            .map((ctx, index) => (
            <div
                key={`${ctx.title}-${index}`}
                className={`document-context-card ${chatStyles.documentContextCard} ${!ctx.sharedLinkId ? chatStyles.documentContextCardStatic : ''}`}
                onClick={ctx.sharedLinkId ? () => router.push(`/s/${ctx.sharedLinkId}`) : undefined}
            >
                <div className={chatStyles.documentContextIcon}><FileText size={20} /></div>
                <div className={chatStyles.documentContextContent}>
                    <div className={chatStyles.documentContextLabel}>Shared Content</div>
                    <div className={chatStyles.documentContextTitle}>{ctx.title}</div>
                </div>
            </div>
        ));
    };

    const renderAppContext = () => {
        const ctx = initialAppContext || (initialAppId ? { id: initialAppId, title: '' } : null);
        if (!ctx) return null;
        return (
            <div
                className={`document-context-card ${chatStyles.documentContextCard}`}
                onClick={() => router.push(`/app/${ctx.id}`)}
            >
                <div className={chatStyles.documentContextIcon}><AppWindow size={20} /></div>
                <div className={chatStyles.documentContextContent}>
                    <div className={chatStyles.documentContextLabel}>App</div>
                    <div className={chatStyles.documentContextTitle}>{ctx.title || 'App'}</div>
                </div>
            </div>
        );
    };

    const isStreaming = isLoading || !!activeJobId;
    const hasEvents = events.length > 0;

    // Smooth auto-scroll during streaming: eases the streaming element's top
    // toward the viewport middle so the status message is prominently visible.
    // Stops once the top reaches the middle. Bails out on manual scroll.
    useEffect(() => {
        if (!isStreaming) return;

        const container = messagesContainerRef.current;
        if (!container) return;

        // Immediately scroll to show the new content (user message + streaming start)
        // This ensures visibility even if streaming completes before the first RAF fires.
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });

        let done = false;
        let userScrolled = false;

        const handleUserScroll = () => { userScrolled = true; };
        container.addEventListener('wheel', handleUserScroll, { passive: true });
        container.addEventListener('touchmove', handleUserScroll, { passive: true });

        let rafId: number;
        const tick = () => {
            if (done || userScrolled) return;

            const streamingMsg = container.querySelector('.message.assistant.streaming');
            if (streamingMsg) {
                const containerRect = container.getBoundingClientRect();
                const msgRect = streamingMsg.getBoundingClientRect();
                const midY = containerRect.top + containerRect.height / 2;

                // Once the top of streaming output reaches the viewport middle, stop
                if (msgRect.top <= midY) {
                    done = true;
                    return;
                }

                // Ease the element's top toward the viewport middle
                const delta = msgRect.top - midY;
                container.scrollTop += Math.ceil(delta * 0.15);
            }

            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(rafId);
            container.removeEventListener('wheel', handleUserScroll);
            container.removeEventListener('touchmove', handleUserScroll);
        };
    }, [isStreaming]);

    return (
        <div className="messages-container" ref={messagesContainerRef}>
            {conversation && hasEvents && (
                <ChatHeader
                    conversation={conversation}
                    showMenu={showMenu}
                    setShowMenu={setShowMenu}
                    onMoveToFolder={() => setShowMoveToFolderModal(true)}
                    onShare={() => setShowShareModal(true)}
                    onPrint={handlePrint}
                    onRename={() => setRenameConfirm({ id: conversation.id, title: conversation.title, type: 'conversation' })}
                    onDelete={() => setDeleteConfirm({ id: conversation.id, title: conversation.title, type: 'conversation' })}
                />
            )}
            <div className={`messages-wrapper ${!hasEvents ? chatStyles.messagesWrapperEmpty : ''}`}>
                {renderAppContext()}
                {renderDocumentContext()}
                {renderContentContext()}
                {!hasEvents && !isStreaming ? (
                    <ChatEmptyState
                        conversation={conversation}
                        initialHighlightsData={initialHighlightsData}
                        onOpenLast={handleOpenLast}
                        onTodayNews={handleTodayNews}
                        isLoading={isLoading}
                        lastOpenedItem={lastOpenedItem}
                        conversationsCount={conversations.length}
                    />
                ) : (
                    <>
                        {events.map((event, idx) => {
                            // Skip thought events that are part of a group (not the first)
                            if (event.kind === 'thought' && idx > 0 && events[idx - 1].kind === 'thought') {
                                return null;
                            }

                            const prevEvent = idx > 0 ? events[idx - 1] : undefined;
                            // For tool_call events, find paired tool_result
                            let pairedResult: ParsedChatEvent | undefined;
                            if (event.kind === 'tool_call' && event.content?.call_id) {
                                pairedResult = toolResultMap.get(event.content.call_id);
                            }

                            // Group consecutive thought events
                            let thoughtGroup: ParsedChatEvent[] | undefined;
                            if (event.kind === 'thought') {
                                thoughtGroup = [event];
                                for (let j = idx + 1; j < events.length && events[j].kind === 'thought'; j++) {
                                    thoughtGroup.push(events[j]);
                                }
                            }

                            // For user messages, get the model name from the event's content
                            let modelName: string | undefined;
                            if (event.kind === 'user_message' && event.content?.model) {
                                modelName = modelsConfig.models.find((m: any) => m.id === event.content.model)?.name || event.content.model;
                            }

                            return (
                                <EventRenderer
                                    key={event.id}
                                    event={event}
                                    conversationId={conversationId}
                                    expandedThoughts={expandedThoughts}
                                    onToggleThoughts={(id) => {
                                        const newSet = new Set(expandedThoughts);
                                        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
                                        setExpandedThoughts(newSet);
                                    }}
                                    onFeedback={handleFeedback}
                                    isFirst={idx === 0}
                                    prevEvent={prevEvent}
                                    pairedToolResult={pairedResult}
                                    activeToolJobs={activeToolJobs}
                                    thoughtGroup={thoughtGroup}
                                    modelName={modelName}
                                />
                            );
                        })}

                        {/* Streaming tail - live content not yet persisted */}
                        {isStreaming && (
                            <StreamingTail
                                streamingText={streamingText}
                                streamingThoughts={streamingThoughts}
                                streamingStatus={streamingStatus}
                                expandedThoughts={expandedThoughts}
                                onToggleThoughts={(id) => {
                                    const newSet = new Set(expandedThoughts);
                                    newSet.has(id) ? newSet.delete(id) : newSet.add(id);
                                    setExpandedThoughts(newSet);
                                }}
                                thoughtsContainerRef={thoughtsContainerRef}
                            />
                        )}

                        {errorMessage && !isStreaming && (
                            <div className="message assistant">
                                <div className="message-content">
                                    <div className="message-text">
                                        <div className="content-styles" style={{ color: 'var(--color-error, #e53e3e)' }}>
                                            {errorMessage}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {hasEvents && !isStreaming && (
                            <ChatActions
                                onSummarize={handleSummarize}
                                onVerify={handleVerify}
                                verifyModel={verifyModel}
                                onVerifyModelChange={handleVerifyModelChange}
                                showVerifyMenu={showVerifyMenu}
                                setShowVerifyMenu={setShowVerifyMenu}
                            />
                        )}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>
            {conversationId && (
                <ShareModal
                    isOpen={showShareModal}
                    onClose={() => setShowShareModal(false)}
                    type="conversation"
                    resourceId={conversationId}
                />
            )}
            {conversationId && (
                <MoveToFolderModal
                    isOpen={showMoveToFolderModal}
                    onClose={() => setShowMoveToFolderModal(false)}
                    currentFolderId={conversation?.folder_id ?? null}
                    folders={folders}
                    onMove={(folderId: string | null) => moveConversationToFolder(conversationId, folderId)}
                />
            )}
        </div>
    );
}
