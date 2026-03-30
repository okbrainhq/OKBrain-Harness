"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface ParsedChatEvent {
    id: string;
    seq: number;
    kind: string;
    content: any;
    feedback?: number | null;
    created_at: string;
}

interface ActiveToolJob {
    toolJobId: string;
    toolName: string;
    command?: string;
    callId?: string;
    state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout';
    sinceSeq: number;
}

function stripYieldTag(text: string): string {
    if (!text) return text;
    return text
        .replace(/<yeild>[\s\S]*?<\/yeild>/ig, "")
        .replace(/<yeild>[\s\S]*?<\/yield>/ig, "")
        .replace(/<yeild>[\s\S]*$/ig, "")
        .replace(/<\/yeild>/ig, "")
        .replace(/<\/yield>/ig, "");
}

interface Conversation {
    id: string;
    title: string;
    folder_id?: string | null;
    grounding_enabled?: number;
    response_mode?: string;
    ai_provider?: string;
    document_ids?: string[];
    created_at: string;
    updated_at: string;
}

export interface YieldedToolJob {
    toolJobId: string;
    toolName: string;
    command?: string;
    callId?: string;
    state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout';
    sinceSeq: number;
    conversationId?: string;
}

export interface UseEventChatStreamingOptions {
    conversationId: string;
    initialEvents: ParsedChatEvent[];
    initialConversation: Conversation | null;
    initialActiveJobId: string | null;
    initialLastJobSeq: number;
    initialStreamingContent: string;
    initialStreamingThoughts: string;
    initialStreamingStatus: string;
    initialYieldWaiting: boolean;
    initialYieldedToolJobs: YieldedToolJob[];

    // Shared context from ChatContext
    modelsConfig: any;
    setConversations: any;
    input: string;
    setInput: (val: string) => void;
    isLoading: boolean;
    setIsLoading: (val: boolean) => void;
    isCancelling: boolean;
    setIsCancelling: (val: boolean) => void;
    thinking: boolean;
    responseMode: 'quick' | 'detailed';
    aiProvider: string;
    defaultFolderId: string | null;
    imageAttachment: any;
    clearImageAttachment: () => void;
    fileAttachments: any[];
    clearFileAttachments: () => void;
    yieldedToolJobs: YieldedToolJob[];
    setYieldedToolJobs: React.Dispatch<React.SetStateAction<YieldedToolJob[]>>;
    onConversationCreated?: (id: string) => void;
    documentContexts: { id: string; title: string }[];
    contentContexts: { title: string; content: string; sharedLinkId?: string }[];
    locationContext: any;
    appId?: string | null;
    sendMessageRef: React.MutableRefObject<any>;
    stopStreamingRef: React.MutableRefObject<any>;
    focusInputRef: React.MutableRefObject<any>;
}

export function useEventChatStreaming({
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
    input,
    setInput,
    isLoading,
    setIsLoading,
    isCancelling,
    setIsCancelling,
    thinking,
    responseMode,
    aiProvider,
    defaultFolderId,
    imageAttachment,
    clearImageAttachment,
    fileAttachments,
    clearFileAttachments,
    yieldedToolJobs,
    setYieldedToolJobs,
    onConversationCreated,
    documentContexts,
    contentContexts,
    locationContext,
    appId,
    sendMessageRef,
    stopStreamingRef,
    focusInputRef,
}: UseEventChatStreamingOptions) {
    const [events, setEvents] = useState<ParsedChatEvent[]>(initialEvents);
    const [streamingText, setStreamingText] = useState(initialStreamingContent || "");
    const [streamingThoughts, setStreamingThoughts] = useState(initialStreamingThoughts || "");
    const [streamingStatus, setStreamingStatus] = useState(initialStreamingStatus || "");
    const [activeJobId, setActiveJobId] = useState<string | null>(initialActiveJobId);
    const [conversationId, setConversationId] = useState<string>(initialConversationId);
    const [conversation, setConversation] = useState<Conversation | null>(initialConversation);
    const [activeToolJobs, setActiveToolJobs] = useState<ActiveToolJob[]>([]);
    const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const eventSourceRef = useRef<EventSource | null>(null);
    const currentJobIdRef = useRef<string | null>(initialActiveJobId);
    const lastSeqRef = useRef<number>(
        initialEvents.length > 0 ? initialEvents[initialEvents.length - 1].seq : 0
    );
    const isWaitingForYieldResumeRef = useRef(false);
    const yieldPollingTokenRef = useRef<string | null>(null);
    const backgroundYieldPollingRef = useRef<string | null>(null);
    const startBackgroundYieldPollRef = useRef<(targetConvId: string, provider: string) => void>(() => { });
    const streamingConversationIdRef = useRef<string>(initialConversationId);
    const isNewConversationRef = useRef(false);
    const lastMessageSourceRef = useRef<'user' | 'action'>('user');
    const lastSentMessageRef = useRef<string | null>(null);
    const lastOptimisticEventIdRef = useRef<string | null>(null);
    // Get latest seq from events
    const getLastSeq = useCallback(() => lastSeqRef.current, []);

    // Append fetched events to state
    const appendEvents = useCallback((newEvents: ParsedChatEvent[]) => {
        if (newEvents.length === 0) return;
        setEvents(prev => {
            const existingSeqs = new Set(prev.map(e => e.seq));
            const deduped = newEvents.filter(e => !existingSeqs.has(e.seq));
            if (deduped.length === 0) return prev;
            // Remove optimistic user events when real user_message arrives
            const hasRealUserMessage = deduped.some(e => e.kind === 'user_message');
            // Remove optimistic stopped event when real stopped event arrives or new events come in
            const hasRealStopped = deduped.some(e => e.kind === 'stopped' && !e.id.startsWith('stopped-'));
            let base = prev;
            if (hasRealUserMessage) {
                base = base.filter(e => !e.id.startsWith('temp-user-'));
            }
            if (hasRealStopped || hasRealUserMessage) {
                base = base.filter(e => !e.id.startsWith('stopped-'));
            }
            const merged = [...base, ...deduped].sort((a, b) => a.seq - b.seq);
            lastSeqRef.current = merged[merged.length - 1].seq;
            return merged;
        });
    }, []);

    // Update conversation sidebar activity
    const updateConversationActivity = useCallback((
        targetConversationId: string | null | undefined,
        activity: {
            activeJobId?: string | null;
            isYielding?: boolean;
            isRunning?: boolean;
            ensureExists?: boolean;
            provider?: string;
        }
    ) => {
        if (!targetConversationId) return;
        setConversations((prev: any[]) => {
            const idx = prev.findIndex((c: any) => c.id === targetConversationId);
            const now = new Date().toISOString();
            const patch: any = { updated_at: now };
            if (activity.activeJobId !== undefined) patch.active_job_id = activity.activeJobId;
            if (activity.isYielding !== undefined) patch.is_yielding = activity.isYielding ? 1 : 0;
            if (activity.isRunning !== undefined) patch.is_running = activity.isRunning ? 1 : 0;
            if (activity.provider) patch.ai_provider = activity.provider;

            if (idx >= 0) {
                return prev.map((c: any, i: number) => i === idx ? { ...c, ...patch } : c);
            }
            if (!activity.ensureExists) return prev;
            return [{
                id: targetConversationId,
                title: "New Chat",
                folder_id: defaultFolderId,
                grounding_enabled: 0,
                response_mode: responseMode,
                ai_provider: activity.provider || aiProvider,
                document_ids: documentContexts.map(doc => doc.id),
                active_job_id: activity.activeJobId ?? null,
                is_yielding: activity.isYielding ? 1 : 0,
                is_running: activity.isRunning ? 1 : 0,
                created_at: now,
                updated_at: now,
            }, ...prev];
        });
    }, [setConversations, defaultFolderId, responseMode, aiProvider, documentContexts]);

    const clearYieldPolling = useCallback(() => {
        yieldPollingTokenRef.current = null;
        if (!backgroundYieldPollingRef.current) {
            isWaitingForYieldResumeRef.current = false;
        }
    }, []);

    // Connect to SSE stream
    const connectToJobStream = useCallback((
        jobId: string,
        finalProvider: string,
        sinceSeq: number = 0,
        targetConversationId?: string,
    ) => {
        let yieldedExit = false;
        isWaitingForYieldResumeRef.current = false;

        const streamUrl = sinceSeq > 0
            ? `/api/jobs/${jobId}/stream?since_seq=${sinceSeq}`
            : `/api/jobs/${jobId}/stream`;
        const eventSource = new EventSource(streamUrl);
        eventSourceRef.current = eventSource;
        currentJobIdRef.current = jobId;

        const knownConvId = targetConversationId || streamingConversationIdRef.current || conversationId;
        updateConversationActivity(knownConvId, {
            activeJobId: jobId,
            isYielding: false,
            isRunning: true,
            ensureExists: true,
            provider: finalProvider,
        });

        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.done) {
                    eventSource.close();
                    eventSourceRef.current = null;
                    currentJobIdRef.current = null;

                    if (yieldedExit || isWaitingForYieldResumeRef.current) {
                        // Yield already handled — ensure input is free
                        setIsLoading(false);
                        const pollConvId = streamingConversationIdRef.current || conversationId;
                        if (pollConvId) {
                            startBackgroundYieldPollRef.current(pollConvId, finalProvider);
                        }
                        return;
                    }

                    // Clear streaming state
                    setStreamingText("");
                    setStreamingThoughts("");
                    setStreamingStatus("");
                    setActiveJobId(null);
                    setActiveToolJobs([]);
                    setIsLoading(false);
                    isNewConversationRef.current = false;

                    // Check if there are still active yield sessions before clearing
                    const doneConvId = streamingConversationIdRef.current || knownConvId;
                    try {
                        const convRes = await fetch(`/api/conversations/${doneConvId}`);
                        if (convRes.ok) {
                            const convData = await convRes.json();
                            if (convData?.is_yielding) {
                                // Still have running yielded jobs — restart polling
                                isWaitingForYieldResumeRef.current = true;
                                updateConversationActivity(doneConvId, {
                                    activeJobId: null,
                                    isYielding: true,
                                    isRunning: false,
                                });
                                startBackgroundYieldPollRef.current(doneConvId, finalProvider);
                                return;
                            }
                        }
                    } catch { /* fetch failed, fall through to clear */ }

                    setYieldedToolJobs([]);
                    updateConversationActivity(doneConvId, {
                        activeJobId: null,
                        isYielding: false,
                        isRunning: false,
                    });
                    return;
                }

                if (data.kind === 'output') {
                    const payload = data.payload;

                    if (payload.type === 'init') {
                        streamingConversationIdRef.current = payload.conversationId;
                        updateConversationActivity(payload.conversationId, {
                            activeJobId: jobId,
                            isYielding: false,
                            isRunning: true,
                            ensureExists: true,
                            provider: finalProvider,
                        });
                        return;
                    }

                    if (payload.type === 'tool_job_started') {
                        setActiveToolJobs(prev => {
                            if (prev.some(t => t.toolJobId === payload.toolJobId)) return prev;
                            return [...prev, {
                                toolJobId: payload.toolJobId,
                                toolName: payload.toolName,
                                command: payload.command,
                                callId: payload.callId,
                                state: payload.state || 'running',
                                sinceSeq: 0,
                            }];
                        });
                        return;
                    }

                    if (payload.final) {
                        if (payload.error) {
                            clearYieldPolling();
                            setStreamingText("");
                            setStreamingThoughts("");
                            setStreamingStatus("");
                            setErrorMessage(payload.error);
                            setActiveJobId(null);
                            setActiveToolJobs([]);
                            setIsLoading(false);

                            // Check if there are still active yield sessions
                            const errConvId = streamingConversationIdRef.current || knownConvId;
                            try {
                                const convRes = await fetch(`/api/conversations/${errConvId}`);
                                if (convRes.ok) {
                                    const convData = await convRes.json();
                                    if (convData?.is_yielding) {
                                        isWaitingForYieldResumeRef.current = true;
                                        updateConversationActivity(errConvId, {
                                            activeJobId: null,
                                            isYielding: true,
                                            isRunning: false,
                                        });
                                        startBackgroundYieldPollRef.current(errConvId, finalProvider);
                                        return;
                                    }
                                }
                            } catch { /* fetch failed */ }

                            setYieldedToolJobs([]);
                            updateConversationActivity(errConvId, {
                                activeJobId: null,
                                isYielding: false,
                                isRunning: false,
                            });
                            return;
                        }

                        if (payload.yielded) {
                            yieldedExit = true;
                            isWaitingForYieldResumeRef.current = true;
                            updateConversationActivity(streamingConversationIdRef.current || knownConvId, {
                                activeJobId: null,
                                isYielding: true,
                                isRunning: false,
                                ensureExists: true,
                                provider: finalProvider,
                            });
                            setStreamingText(prev => payload.stripYieldTag ? stripYieldTag(prev) : prev);
                            setStreamingStatus("Waiting for tools to complete");

                            if (Array.isArray(payload.toolJobs) && payload.toolJobs.length > 0) {
                                // Parse tool jobs up front
                                const parsedJobs: ActiveToolJob[] = payload.toolJobs.map((tj: any) => {
                                    let command: string | undefined;
                                    let callId: string | undefined;
                                    try {
                                        const meta = tj.metadata ? JSON.parse(tj.metadata) : undefined;
                                        command = meta?.command;
                                        callId = meta?.callId;
                                    } catch { }
                                    return { toolJobId: tj.job_id, toolName: tj.tool_name, command, callId, state: (tj.state || 'running') as ActiveToolJob['state'], sinceSeq: 0 };
                                });

                                setActiveToolJobs(prev => {
                                    const seen = new Set(prev.map(j => j.toolJobId));
                                    const deduped = parsedJobs.filter(j => !seen.has(j.toolJobId));
                                    return deduped.length > 0 ? [...prev, ...deduped] : prev;
                                });
                                // Also add to yieldedToolJobs (persists across user messages)
                                const yieldConvId = streamingConversationIdRef.current || conversationId;
                                setYieldedToolJobs(prev => {
                                    const existing = new Set(prev.map(j => j.toolJobId));
                                    const added = parsedJobs
                                        .filter(j => !existing.has(j.toolJobId))
                                        .map(j => ({ ...j, conversationId: yieldConvId }));
                                    return added.length > 0 ? [...prev, ...added] : prev;
                                });
                            }

                            // Apply title and conversation updates if present
                            if (payload.title && payload.conversation) {
                                setConversation(payload.conversation);
                                setConversations((prev: any) => {
                                    const exists = prev.find((c: any) => c.id === payload.conversation.id);
                                    if (exists) return prev.map((c: any) => c.id === payload.conversation.id ? payload.conversation : c);
                                    return [payload.conversation, ...prev];
                                });
                            }

                            // Close the EventSource and free the input immediately
                            eventSource.close();
                            eventSourceRef.current = null;
                            currentJobIdRef.current = null;
                            setIsLoading(false);
                            // Start background yield polling independently
                            const pollConvId = streamingConversationIdRef.current || conversationId;
                            if (pollConvId) {
                                startBackgroundYieldPollRef.current(pollConvId, finalProvider);
                            }
                            return;
                        }

                        // Success: title and conversation updates
                        if (payload.title && payload.conversation) {
                            setConversation(payload.conversation);
                            setConversations((prev: any) => {
                                const exists = prev.find((c: any) => c.id === payload.conversation.id);
                                if (exists) return prev.map((c: any) => c.id === payload.conversation.id ? payload.conversation : c);
                                return [payload.conversation, ...prev];
                            });
                        }
                        return;
                    }

                    // Regular text chunk
                    if (payload.text) {
                        const visibleText = stripYieldTag(payload.text);
                        if (visibleText) {
                            setStreamingText(prev => prev + visibleText);
                        }
                    }
                } else if (data.kind === 'thought') {
                    if (data.payload?.text) {
                        setStreamingThoughts(prev => prev + data.payload.text);
                    }
                } else if (data.kind === 'status') {
                    if (data.payload?.status) {
                        setStreamingStatus(data.payload.status);
                    }
                } else if (data.kind === 'event_persisted') {
                    // A chat event was persisted to DB — use event data from payload
                    if (data.payload?.event) {
                        appendEvents([data.payload.event]);
                        const eventKind = data.payload?.event_kind;
                        if (eventKind === 'assistant_text') {
                            setStreamingText("");
                        } else if (eventKind === 'thought') {
                            setStreamingThoughts("");
                        } else if (eventKind === 'compaction') {
                            setStreamingStatus("");
                        }
                    }
                }
            } catch (e) {
                console.warn("Parse error for event:", event.data, e);
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            eventSourceRef.current = null;
            currentJobIdRef.current = null;
            if (yieldedExit || isWaitingForYieldResumeRef.current) {
                setIsLoading(false);
                const pollConvId = streamingConversationIdRef.current || conversationId;
                if (pollConvId) {
                    startBackgroundYieldPollRef.current(pollConvId, finalProvider);
                }
                return;
            }
            clearYieldPolling();
            updateConversationActivity(streamingConversationIdRef.current || knownConvId, {
                activeJobId: null,
                isYielding: false,
                isRunning: false,
            });
            setStreamingText("");
            setStreamingThoughts("");
            setStreamingStatus("");
            setActiveJobId(null);
            setActiveToolJobs([]);
            setIsLoading(false);
        };

        return eventSource;
    }, [conversationId, appendEvents, setIsLoading, clearYieldPolling, updateConversationActivity]);

    // Background yield poll — runs independently of isLoading
    startBackgroundYieldPollRef.current = (targetConvId: string, finalProvider: string) => {
        const pollingToken = `bg-${Date.now()}-${Math.random()}`;
        backgroundYieldPollingRef.current = pollingToken;
        isWaitingForYieldResumeRef.current = true;

        const poll = async () => {
            while (backgroundYieldPollingRef.current === pollingToken) {
                try {
                    const res = await fetch(`/api/conversations/${targetConvId}`);
                    if (!res.ok) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    const latest = await res.json();

                    if (!latest?.active_job_id) {
                        // No resume job yet — check if all yield sessions are resolved
                        if (!latest?.is_yielding) {
                            backgroundYieldPollingRef.current = null;
                            isWaitingForYieldResumeRef.current = false;
                            setYieldedToolJobs([]);
                            updateConversationActivity(targetConvId, {
                                activeJobId: null,
                                isYielding: false,
                                isRunning: false,
                            });
                            // Fetch final events from server
                            try {
                                const eventsRes = await fetch(`/api/conversations/${targetConvId}/events`);
                                if (eventsRes.ok) {
                                    const data = await eventsRes.json();
                                    if (data.events) {
                                        setEvents(data.events);
                                        lastSeqRef.current = data.events.length > 0
                                            ? data.events[data.events.length - 1].seq
                                            : 0;
                                    }
                                    if (data.conversation) {
                                        setConversation(data.conversation);
                                        setConversations((prev: any[]) => {
                                            const idx = prev.findIndex((c: any) => c.id === data.conversation.id);
                                            if (idx >= 0) return prev.map((c: any, i: number) => i === idx ? data.conversation : c);
                                            return prev;
                                        });
                                    }
                                }
                            } catch { /* events fetch failed */ }
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    // Resume job detected — wait for user to be idle
                    if (eventSourceRef.current || currentJobIdRef.current) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    // User is idle — connect to the resume stream
                    backgroundYieldPollingRef.current = null;
                    isWaitingForYieldResumeRef.current = false;
                    setActiveJobId(latest.active_job_id);
                    setIsLoading(true);
                    updateConversationActivity(targetConvId, {
                        activeJobId: latest.active_job_id,
                        isYielding: false,
                        isRunning: true,
                        ensureExists: true,
                        provider: latest.ai_provider || finalProvider,
                    });
                    connectToJobStream(latest.active_job_id, finalProvider, 0, targetConvId);
                    return;
                } catch { /* polling error */ }

                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        };
        void poll();
    };

    // Resume streaming if there's an active job on mount
    useEffect(() => {
        if (initialActiveJobId && initialConversation) {
            const provider = initialConversation.ai_provider || modelsConfig.defaultModelId;
            setIsLoading(true);
            updateConversationActivity(initialConversationId, {
                activeJobId: initialActiveJobId,
                isYielding: false,
                isRunning: true,
                ensureExists: true,
                provider,
            });
            connectToJobStream(initialActiveJobId, provider, initialLastJobSeq, initialConversationId);
            return;
        }

        if (initialYieldWaiting && initialConversation) {
            const provider = initialConversation.ai_provider || modelsConfig.defaultModelId;
            updateConversationActivity(initialConversationId, {
                activeJobId: null,
                isYielding: true,
                isRunning: false,
                ensureExists: true,
                provider,
            });
            // Hydrate yielded tool jobs from SSR
            if (initialYieldedToolJobs.length > 0) {
                setYieldedToolJobs(initialYieldedToolJobs.map(j => ({ ...j, conversationId: initialConversationId })));
            }
            // Input stays free — start background polling
            setIsLoading(false);
            startBackgroundYieldPollRef.current(initialConversationId, provider);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialActiveJobId, initialYieldWaiting, initialConversationId]);

    // Send message
    const sendMessage = useCallback(async (options?: {
        message?: string;
        provider?: string;
        skipProviderUpdate?: boolean;
        endpoint?: string;
        thinking?: boolean;
    }) => {
        const messageText = options?.message || input;
        if (!messageText.trim() && !imageAttachment && fileAttachments.length === 0) return;
        if (isLoading) return;

        setIsLoading(true);

        const endpoint = options?.endpoint || "/api/chat";
        const isUserTyping = !options?.message && endpoint === "/api/chat";
        lastMessageSourceRef.current = isUserTyping ? 'user' : 'action';
        lastSentMessageRef.current = isUserTyping ? messageText : "";

        setInput("");
        setErrorMessage(null);
        setStreamingText("");
        setStreamingThoughts("");
        setStreamingStatus("");
        const finalProvider = options?.provider || aiProvider;
        const finalThinking = options?.thinking !== undefined ? options.thinking : thinking;

        // Add optimistic user_message event
        const optimisticAttachments = fileAttachments.length > 0
            ? fileAttachments.map((f: any) => ({ name: f.fileName, uri: f.uri, mime_type: f.mimeType }))
            : undefined;
        const optimisticUserEvent: ParsedChatEvent = {
            id: `temp-user-${Date.now()}`,
            seq: lastSeqRef.current + 0.5, // fractional seq for optimistic
            kind: 'user_message',
            content: { text: messageText, model: finalProvider, ...(optimisticAttachments ? { attachments: optimisticAttachments } : {}) },
            created_at: new Date().toISOString(),
        };
        lastOptimisticEventIdRef.current = optimisticUserEvent.id;
        setEvents(prev => [...prev, optimisticUserEvent]);

        try {
            const body: any = {
                message: messageText,
                conversationId: conversationId || undefined,
                thinking: finalThinking,
                mode: responseMode,
                folderId: defaultFolderId,
                aiProvider: finalProvider,
                skipProviderUpdate: options?.skipProviderUpdate,
                documentIds: documentContexts.map(doc => doc.id),
            };

            if (contentContexts.length > 0) {
                body.contentContexts = contentContexts.map(ctx => ({
                    title: ctx.title,
                    content: ctx.content,
                    sharedLinkId: ctx.sharedLinkId,
                }));
            }
            if (appId) {
                body.appId = appId;
            }
            // Fetch location if tracking is enabled
            if (locationContext.isTrackingEnabled) {
                try {
                    const loc = await locationContext.getLocation((status: string) => {
                        setStreamingStatus(status);
                    });
                    if (loc) {
                        body.location = loc;
                    }
                } catch (e) {
                    console.log("Location fetch skipped:", e);
                }
            }
            if (imageAttachment) {
                body.imageData = {
                    mimeType: imageAttachment.mimeType,
                    base64: imageAttachment.base64,
                };
                clearImageAttachment();
            }
            if (fileAttachments.length > 0) {
                body.files = fileAttachments.map((f: any) => ({
                    uri: f.uri,
                    mimeType: f.mimeType,
                    name: f.name,
                    fileName: f.fileName,
                }));
                clearFileAttachments();
            }

            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to send message");
            }

            if (data.conversationId && data.conversationId !== conversationId) {
                setConversationId(data.conversationId);
                streamingConversationIdRef.current = data.conversationId;
                isNewConversationRef.current = true;

                if (data.isNewConversation) {
                    window.history.replaceState(null, "", `/chat/${data.conversationId}`);
                    onConversationCreated?.(data.conversationId);
                }
            }

            if (data.jobId) {
                setActiveJobId(data.jobId);
                connectToJobStream(data.jobId, finalProvider, 0, data.conversationId || conversationId);
            }
        } catch (error: any) {
            console.error("Send error:", error);
            // Remove optimistic event
            setEvents(prev => prev.filter(e => e.id !== optimisticUserEvent.id));
            setIsLoading(false);
            setStreamingStatus("");
        }
    }, [input, isLoading, conversationId, aiProvider, thinking, responseMode, defaultFolderId, documentContexts, contentContexts,
        locationContext, imageAttachment, fileAttachments, clearImageAttachment, clearFileAttachments,
        modelsConfig, setInput, setIsLoading, connectToJobStream, onConversationCreated]);

    // Stop streaming
    const stopStreaming = useCallback(async () => {
        if (isCancelling) return;
        setIsCancelling(true);
        const jobId = currentJobIdRef.current || activeJobId;
        if (!jobId) {
            setIsCancelling(false);
            return;
        }

        // Show "Cancelling" status
        setStreamingStatus("Cancelling");

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        currentJobIdRef.current = null;
        clearYieldPolling();

        try {
            await fetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
        } catch { }

        // New stop behavior: server preserves partial progress and adds a 'stopped' event.
        // Add the stopped event directly so the UI shows "User cancelled" immediately.
        // Use lastSeqRef + 0.5 to keep seq ordering sane for subsequent messages.
        const stoppedEvent: ParsedChatEvent = {
            id: `stopped-${Date.now()}`,
            seq: lastSeqRef.current + 0.5,
            kind: 'stopped',
            content: { model: '' },
            feedback: null,
            created_at: new Date().toISOString(),
        };
        setEvents(prev => [...prev, stoppedEvent].sort((a, b) => a.seq - b.seq));
        lastSeqRef.current = stoppedEvent.seq;

        isNewConversationRef.current = false;

        // Preserve yielding state if background yield polls are still active
        const hasActiveYieldPoll = !!backgroundYieldPollingRef.current;
        updateConversationActivity(streamingConversationIdRef.current || conversationId, {
            activeJobId: null,
            isYielding: hasActiveYieldPoll,
            isRunning: hasActiveYieldPoll,
        });

        setStreamingText("");
        setStreamingThoughts("");
        setStreamingStatus("");
        setActiveJobId(null);
        setActiveToolJobs([]);
        setIsLoading(false);
        setIsCancelling(false);

        lastSentMessageRef.current = null;
        lastOptimisticEventIdRef.current = null;

        if (lastMessageSourceRef.current === 'user') {
            setTimeout(() => {
                focusInputRef.current?.();
            }, 0);
        }
    }, [isCancelling, activeJobId, conversationId, setIsLoading, setIsCancelling, setInput, clearYieldPolling, updateConversationActivity, focusInputRef, setConversations]);

    // Wire refs
    useEffect(() => {
        sendMessageRef.current = sendMessage;
        return () => { sendMessageRef.current = null; };
    }, [sendMessage, sendMessageRef]);

    useEffect(() => {
        stopStreamingRef.current = stopStreaming;
        return () => { stopStreamingRef.current = null; };
    }, [stopStreaming, stopStreamingRef]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
            backgroundYieldPollingRef.current = null;
            clearYieldPolling();
        };
    }, [clearYieldPolling]);

    return {
        events,
        setEvents,
        streamingText,
        streamingThoughts,
        streamingStatus,
        activeJobId,
        isLoading,
        activeToolJobs,
        expandedThoughts,
        setExpandedThoughts,
        errorMessage,
        conversationId,
        conversation,
        setConversation,
        sendMessage,
        stopStreaming,
    };
}
