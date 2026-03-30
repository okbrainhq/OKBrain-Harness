import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, Conversation, ToolJobData, StreamingTimelineItem } from "../app/components/ChatView";

interface ActiveToolJob {
    toolJobId: string;
    toolName: string;
    command?: string;
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

function mergeTextWithoutReplacing(existing?: string, incoming?: string): string | undefined {
    const base = existing || "";
    const next = incoming || "";
    if (!base && !next) return undefined;
    if (!base) return next;
    if (!next) return base;
    if (next.startsWith(base)) return next;
    if (base.endsWith(next)) return base;
    return `${base}${next}`;
}

function getLatestAssistantId(messages: Message[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "assistant" || msg.role === "summary") {
            return msg.id;
        }
    }
    return null;
}

interface UseChatStreamingOptions {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    conversationId: string | null;
    setConversationId: (id: string | null) => void;
    conversation: Conversation | null;
    setConversation: (conv: Conversation | null) => void;
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
    onConversationCreated?: (id: string) => void;
    onConversationReset?: () => void;
    documentContexts: { id: string; title: string }[];
    contentContexts: { title: string; content: string; sharedLinkId?: string }[];
    locationContext: any;
    appId?: string | null;
    sendMessageRef: React.MutableRefObject<any>;
    stopStreamingRef: React.MutableRefObject<any>;
    focusInputRef: React.MutableRefObject<any>;
    streamingMessageRef: React.RefObject<HTMLDivElement | null>;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    messagesContainerRef: React.RefObject<HTMLDivElement | null>;
    thoughtsContainerRef: React.RefObject<HTMLDivElement | null>;
    initialStreamingMessageId: string | null;
    initialStreamingThoughts: string;
    initialActiveJobId: string | null;
    initialLastSeq: number;
    initialStreamingTimeline: StreamingTimelineItem[];
    initialYieldWaiting: boolean;
    initialToolJobs: ToolJobData[];
}

export function useChatStreaming({
    messages,
    setMessages,
    conversationId,
    setConversationId,
    conversation,
    setConversation,
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
    onConversationCreated,
    onConversationReset,
    documentContexts,
    contentContexts,
    locationContext,
    appId,
    sendMessageRef,
    stopStreamingRef,
    focusInputRef,
    streamingMessageRef,
    messagesEndRef,
    messagesContainerRef,
    thoughtsContainerRef,
    initialStreamingMessageId,
    initialStreamingThoughts,
    initialActiveJobId,
    initialLastSeq,
    initialStreamingTimeline,
    initialYieldWaiting,
    initialToolJobs,
}: UseChatStreamingOptions) {
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(initialStreamingMessageId);
    const [streamingThoughts, setStreamingThoughts] = useState<string>(initialStreamingThoughts || "");
    const [streamingTimeline, setStreamingTimeline] = useState<StreamingTimelineItem[]>(initialStreamingTimeline || []);
    const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());
    const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
    const [thinkingDuration, setThinkingDuration] = useState<number | null>(null);
    const [finalThoughts, setFinalThoughts] = useState<string>("");
    const [activeToolJobs, setActiveToolJobs] = useState<ActiveToolJob[]>(
        (initialToolJobs || [])
            .filter((job) => !job.message_id && job.state === 'running')
            .map((job) => {
                let command: string | undefined;
                try {
                    const metadata = job.metadata ? JSON.parse(job.metadata) : null;
                    command = metadata?.command;
                } catch {
                    command = undefined;
                }
                return {
                    toolJobId: job.job_id,
                    toolName: job.tool_name,
                    command,
                    state: job.state,
                    sinceSeq: 0,
                };
            })
    );

    const streamingConversationIdRef = useRef<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const currentJobIdRef = useRef<string | null>(null);
    const lastSentMessageRef = useRef<string>("");
    const lastMessageSourceRef = useRef<'user' | 'action'>('user');
    const lastAssistantMessageIdBeforeSendRef = useRef<string | null>(
        getLatestAssistantId(messages.filter((msg) => !msg.id.startsWith('temp-')))
    );
    const isWaitingForYieldResumeRef = useRef(false);
    const yieldPollingTokenRef = useRef<string | null>(null);
    const backgroundYieldPollingRef = useRef<string | null>(null);
    const startYieldPollingRef = useRef<(targetConversationId: string, tempAssistantMessageId: string, finalProvider: string, onDone?: () => void) => void>(() => { });
    const startBackgroundYieldPollRef = useRef<(targetConversationId: string, finalProvider: string) => void>(() => { });
    const messagesAddedRef = useRef<number>(0);
    const isNewConversationRef = useRef(false);
    const timelineCounterRef = useRef(0);

    const appendStreamingTimeline = useCallback((kind: StreamingTimelineItem["kind"], text: string) => {
        const normalizedText = typeof text === "string" ? text : "";
        if (!normalizedText) return;

        setStreamingTimeline((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.kind === kind) {
                if (kind === "status") {
                    if (last.text === normalizedText) return prev;
                    return [...prev.slice(0, -1), { ...last, text: normalizedText }];
                }
                return [...prev.slice(0, -1), { ...last, text: `${last.text}${normalizedText}` }];
            }

            timelineCounterRef.current += 1;
            return [
                ...prev,
                {
                    id: `stream-${kind}-${timelineCounterRef.current}`,
                    kind,
                    text: normalizedText,
                },
            ];
        });
    }, []);

    const clearYieldPolling = useCallback(() => {
        yieldPollingTokenRef.current = null;
        // Only clear yield waiting if no background poll is active
        if (!backgroundYieldPollingRef.current) {
            isWaitingForYieldResumeRef.current = false;
        }
    }, []);

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

            if (activity.activeJobId !== undefined) {
                patch.active_job_id = activity.activeJobId;
            }
            if (activity.isYielding !== undefined) {
                patch.is_yielding = activity.isYielding ? 1 : 0;
            }
            if (activity.isRunning !== undefined) {
                patch.is_running = activity.isRunning ? 1 : 0;
            }
            if (activity.provider) {
                patch.ai_provider = activity.provider;
            }

            if (idx >= 0) {
                return prev.map((c: any, i: number) => i === idx ? { ...c, ...patch } : c);
            }

            if (!activity.ensureExists) {
                return prev;
            }

            return [
                {
                    id: targetConversationId,
                    title: "New Chat",
                    folder_id: defaultFolderId,
                    grounding_enabled: 0,
                    response_mode: responseMode,
                    ai_provider: activity.provider || aiProvider,
                    document_ids: documentContexts.map((doc) => doc.id),
                    active_job_id: activity.activeJobId ?? null,
                    is_yielding: activity.isYielding ? 1 : 0,
                    is_running: activity.isRunning ? 1 : 0,
                    created_at: now,
                    updated_at: now,
                },
                ...prev,
            ];
        });
    }, [setConversations, defaultFolderId, responseMode, aiProvider, documentContexts]);


    // Resume streaming if there's an active job on mount
    useEffect(() => {
        if (initialActiveJobId && conversation) {
            const tempAssistantMessageId = `temp-assistant-resume-${initialActiveJobId}`;
            const provider = conversation.ai_provider || modelsConfig.defaultModelId;
            const targetConversationId = conversationId || conversation.id;

            timelineCounterRef.current = initialStreamingTimeline.length;
            setStreamingTimeline(initialStreamingTimeline || []);
            setStreamingThoughts(initialStreamingThoughts || "");
            messagesAddedRef.current = 1;
            setIsLoading(true);
            updateConversationActivity(targetConversationId, {
                activeJobId: initialActiveJobId,
                isYielding: false,
                isRunning: true,
                ensureExists: true,
                provider,
            });

            connectToJobStream(initialActiveJobId, tempAssistantMessageId, provider, undefined, initialLastSeq, targetConversationId);
            return;
        }

        if (initialYieldWaiting && conversation && conversationId) {
            const provider = conversation.ai_provider || modelsConfig.defaultModelId;

            updateConversationActivity(conversationId, {
                activeJobId: null,
                isYielding: true,
                isRunning: false,
                ensureExists: true,
                provider,
            });
            // Input stays free — start background polling
            setIsLoading(false);
            startBackgroundYieldPollRef.current(conversationId, provider);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialActiveJobId, initialStreamingTimeline, initialStreamingThoughts, initialYieldWaiting, conversationId, initialStreamingMessageId]);

    const connectToJobStream = useCallback((
        jobId: string,
        tempAssistantMessageId: string,
        finalProvider: string,
        onDone?: () => void,
        sinceSeq: number = 0,
        targetConversationId?: string | null,
    ) => {
        let accumulatedThoughts = sinceSeq > 0 ? (initialStreamingThoughts || "") : "";
        let localThinkingStartTime: number | null = null;
        let localThinkingDuration: number | undefined;
        let yieldedExit = false;
        isWaitingForYieldResumeRef.current = false;

        const streamUrl = sinceSeq > 0
            ? `/api/jobs/${jobId}/stream?since_seq=${sinceSeq}`
            : `/api/jobs/${jobId}/stream`;
        const eventSource = new EventSource(streamUrl);
        eventSourceRef.current = eventSource;
        currentJobIdRef.current = jobId;
        const knownConversationId = targetConversationId || streamingConversationIdRef.current || conversationId;
        updateConversationActivity(knownConversationId, {
            activeJobId: jobId,
            isYielding: false,
            isRunning: true,
            ensureExists: true,
            provider: finalProvider,
        });

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.done) {
                    eventSource.close();
                    eventSourceRef.current = null;
                    currentJobIdRef.current = null;
                    if (yieldedExit || isWaitingForYieldResumeRef.current) {
                        // Yield already handled in payload.yielded — just ensure input is free
                        setIsLoading(false);
                        setStreamingMessageId(null);
                        setStreamingTimeline([]);
                        const pollConversationId = streamingConversationIdRef.current || conversationId;
                        if (pollConversationId) {
                            startBackgroundYieldPollRef.current(pollConversationId, finalProvider);
                        }
                        return;
                    }

                    updateConversationActivity(streamingConversationIdRef.current || targetConversationId || conversationId, {
                        activeJobId: null,
                        isYielding: false,
                        isRunning: false,
                    });
                    streamingConversationIdRef.current = null;
                    isNewConversationRef.current = false;
                    setStreamingMessageId(null);
                    setStreamingTimeline([]);
                    setIsLoading(false);
                    setActiveToolJobs([]);
                    onDone?.();
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
                        setActiveToolJobs((prev) => {
                            if (prev.some((t) => t.toolJobId === payload.toolJobId)) return prev;
                            return [
                                ...prev,
                                {
                                    toolJobId: payload.toolJobId,
                                    toolName: payload.toolName,
                                    command: payload.command,
                                    state: payload.state || 'running',
                                    sinceSeq: 0,
                                },
                            ];
                        });
                        return;
                    }

                    if (payload.final) {
                        if (payload.error) {
                            console.error("Chat error:", payload.error);
                            clearYieldPolling();
                            updateConversationActivity(streamingConversationIdRef.current || targetConversationId || conversationId, {
                                activeJobId: null,
                                isYielding: false,
                                isRunning: false,
                            });
                            setMessages((prev) =>
                                prev.map((msg) =>
                                    msg.id === tempAssistantMessageId
                                        ? { ...msg, error: payload.error }
                                        : msg
                                )
                            );
                            setStreamingMessageId(null);
                            setStreamingTimeline([]);
                            setIsLoading(false);
                            setActiveToolJobs([]);
                            return;
                        }

                        if (payload.yielded) {
                            yieldedExit = true;
                            isWaitingForYieldResumeRef.current = true;
                            updateConversationActivity(streamingConversationIdRef.current || targetConversationId || conversationId, {
                                activeJobId: null,
                                isYielding: true,
                                isRunning: false,
                                ensureExists: true,
                                provider: finalProvider,
                            });
                            setMessages((prev) =>
                                prev.map((msg) =>
                                    msg.id === tempAssistantMessageId
                                        ? {
                                            ...msg,
                                            content: payload.stripYieldTag ? stripYieldTag(msg.content) : msg.content,
                                            thoughts: accumulatedThoughts || msg.thoughts,
                                            thinking_duration: payload.thinkingDuration ?? localThinkingDuration ?? msg.thinking_duration,
                                            status: "Waiting for tools to complete",
                                        }
                                        : msg
                                )
                            );

                            if (Array.isArray(payload.toolJobs) && payload.toolJobs.length > 0) {
                                setActiveToolJobs((prev) => {
                                    const next = [...prev];
                                    const seen = new Set(prev.map((job) => job.toolJobId));
                                    for (const toolJob of payload.toolJobs) {
                                        if (seen.has(toolJob.job_id)) continue;
                                        let command: string | undefined;
                                        try {
                                            command = toolJob.metadata ? JSON.parse(toolJob.metadata)?.command : undefined;
                                        } catch {
                                            command = undefined;
                                        }
                                        next.push({
                                            toolJobId: toolJob.job_id,
                                            toolName: toolJob.tool_name,
                                            command,
                                            state: toolJob.state || 'running',
                                            sinceSeq: 0,
                                        });
                                    }
                                    return next;
                                });
                            }

                            eventSource.close();
                            eventSourceRef.current = null;
                            currentJobIdRef.current = null;
                            // Free the input immediately — user can send new messages
                            setIsLoading(false);
                            setStreamingMessageId(null);
                            setStreamingTimeline([]);
                            // Start background yield polling independently
                            const pollConversationId = streamingConversationIdRef.current || conversationId;
                            if (pollConversationId) {
                                startBackgroundYieldPollRef.current(pollConversationId, finalProvider);
                            }
                            return;
                        }

                        const sourcesJson = payload.sources ? JSON.stringify(payload.sources) : undefined;
                        const finalDuration = payload.thinkingDuration ?? localThinkingDuration;
                        if (finalDuration !== undefined) {
                            setThinkingDuration(finalDuration);
                        }
                        const thoughtsForMessage = accumulatedThoughts || undefined;
                        if (thoughtsForMessage) {
                            setFinalThoughts(thoughtsForMessage);
                        }

                        setMessages((prev) =>
                            prev.map((msg) =>
                                msg.id === tempAssistantMessageId
                                    ? (() => {
                                        const mergedThoughts = mergeTextWithoutReplacing(msg.thoughts, thoughtsForMessage);
                                        const mergedThinkingDuration = finalDuration !== undefined
                                            ? (msg.thinking_duration || 0) + finalDuration
                                            : msg.thinking_duration;

                                        return {
                                            ...msg,
                                            id: payload.messageId || msg.id,
                                            sources: sourcesJson,
                                            model: payload.model || (modelsConfig.models.find((m: any) => m.id === finalProvider)?.name ?? finalProvider),
                                            wasGrounded: false,
                                            status: undefined,
                                            thoughts: mergedThoughts,
                                            thinking_duration: mergedThinkingDuration,
                                            tool_jobs: payload.toolJobs || msg.tool_jobs
                                        };
                                    })()
                                    : msg
                            )
                        );

                        if (payload.title && payload.conversation) {
                            setConversation(payload.conversation);
                            setConversations((prev: any) => {
                                const exists = prev.find((c: any) => c.id === payload.conversation.id);
                                if (exists) {
                                    return prev.map((c: any) =>
                                        c.id === payload.conversation.id ? payload.conversation : c
                                    );
                                }
                                return [payload.conversation, ...prev];
                            });
                        }
                        updateConversationActivity(payload?.conversation?.id || streamingConversationIdRef.current || targetConversationId || conversationId, {
                            activeJobId: null,
                            isYielding: false,
                            isRunning: false,
                        });

                        clearYieldPolling();
                        setStreamingMessageId(null);
                        setStreamingTimeline([]);
                        setActiveToolJobs([]);
                        return;
                    }

                    if (payload.text) {
                        const visibleText = stripYieldTag(payload.text);
                        if (!visibleText) {
                            return;
                        }
                        if (accumulatedThoughts && localThinkingDuration === undefined) {
                            if (localThinkingStartTime) {
                                localThinkingDuration = Math.round((Date.now() - localThinkingStartTime) / 1000);
                                setThinkingDuration(localThinkingDuration);
                            }
                            setFinalThoughts(accumulatedThoughts);
                        }
                        appendStreamingTimeline('output', visibleText);
                        setMessages((prev) =>
                            prev.map((msg) =>
                                msg.id === tempAssistantMessageId
                                    ? { ...msg, content: msg.content + visibleText }
                                    : msg
                            )
                        );


                    }
                } else if (data.kind === 'thought') {
                    if (localThinkingStartTime === null) {
                        localThinkingStartTime = Date.now();
                    }
                    setThinkingStartTime((prev) => prev === null ? Date.now() : prev);
                    accumulatedThoughts += data.payload.text;
                    setStreamingThoughts((prev) => prev + data.payload.text);
                    appendStreamingTimeline('thought', data.payload.text);
                } else if (data.kind === 'status') {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === tempAssistantMessageId
                                ? { ...msg, status: data.payload.status }
                                : msg
                        )
                    );
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
                setStreamingMessageId(null);
                setStreamingTimeline([]);
                const pollConversationId = streamingConversationIdRef.current || conversationId;
                if (pollConversationId) {
                    startBackgroundYieldPollRef.current(pollConversationId, finalProvider);
                }
                return;
            }
            streamingConversationIdRef.current = null;
            clearYieldPolling();
            updateConversationActivity(streamingConversationIdRef.current || targetConversationId || conversationId, {
                activeJobId: null,
                isYielding: false,
                isRunning: false,
            });
            setStreamingMessageId(null);
            setStreamingTimeline([]);
            setIsLoading(false);
            setActiveToolJobs([]);
        };

        return eventSource;
    }, [appendStreamingTimeline, setConversations, setIsLoading, modelsConfig.models, initialStreamingThoughts, conversationId, setMessages, clearYieldPolling, updateConversationActivity]);

    const startBackgroundYieldPoll = useCallback((
        targetConversationId: string,
        finalProvider: string,
    ) => {
        // Background yield poll runs independently of isLoading.
        // It polls the conversation for a new active_job_id (resume).
        // When found, it waits until isLoading is false before connecting.
        const pollingToken = `bg-${Date.now()}-${Math.random()}`;
        backgroundYieldPollingRef.current = pollingToken;
        isWaitingForYieldResumeRef.current = true;

        const poll = async () => {
            while (backgroundYieldPollingRef.current === pollingToken) {
                try {
                    const conversationResponse = await fetch(`/api/conversations/${targetConversationId}`);
                    if (!conversationResponse.ok) {
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        continue;
                    }
                    const latestConversation = await conversationResponse.json();

                    if (!latestConversation?.active_job_id) {
                        // No resume job yet — check if all yield sessions are resolved
                        const hasActiveYields = latestConversation?.is_yielding;
                        if (!hasActiveYields) {
                            // All yields resolved (possibly via page reload completing while we weren't looking)
                            backgroundYieldPollingRef.current = null;
                            isWaitingForYieldResumeRef.current = false;
                            updateConversationActivity(targetConversationId, {
                                activeJobId: null,
                                isYielding: false,
                                isRunning: false,
                            });
                            return;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        continue;
                    }

                    // Resume job detected — wait for user to be idle (isLoading=false)
                    // Check by looking at whether we currently have an active event source
                    if (eventSourceRef.current || currentJobIdRef.current) {
                        // User is mid-stream — wait and re-check
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        continue;
                    }

                    // User is idle — connect to the resume stream
                    backgroundYieldPollingRef.current = null;
                    isWaitingForYieldResumeRef.current = false;

                    const resumeMessageId = `temp-assistant-resume-${latestConversation.active_job_id}`;
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: resumeMessageId,
                            role: "assistant" as const,
                            content: "",
                            model: modelsConfig.models.find((m: any) => m.id === (latestConversation.ai_provider || finalProvider))?.name ?? finalProvider,
                            wasGrounded: false,
                            created_at: new Date().toISOString(),
                        },
                    ]);
                    messagesAddedRef.current = 1;
                    setStreamingMessageId(resumeMessageId);
                    setStreamingTimeline([]);
                    setStreamingThoughts("");
                    setIsLoading(true);
                    updateConversationActivity(targetConversationId, {
                        activeJobId: latestConversation.active_job_id,
                        isYielding: false,
                        isRunning: true,
                        ensureExists: true,
                        provider: latestConversation.ai_provider || finalProvider,
                    });
                    connectToJobStream(latestConversation.active_job_id, resumeMessageId, latestConversation.ai_provider || finalProvider, undefined, 0, targetConversationId);
                    return;
                } catch {
                    // keep polling
                }

                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        };

        void poll();
    }, [connectToJobStream, setIsLoading, setMessages, updateConversationActivity, modelsConfig.models]);

    startBackgroundYieldPollRef.current = startBackgroundYieldPoll;

    const startYieldPolling = useCallback((
        targetConversationId: string,
        tempAssistantMessageId: string,
        finalProvider: string,
        onDone?: () => void
    ) => {
        clearYieldPolling();
        isWaitingForYieldResumeRef.current = true;
        updateConversationActivity(targetConversationId, {
            activeJobId: null,
            isYielding: true,
            isRunning: true,
            ensureExists: true,
            provider: finalProvider,
        });

        setMessages((prev) =>
            prev.map((msg) =>
                msg.id === tempAssistantMessageId
                    ? { ...msg, status: "Waiting for tools to complete" }
                    : msg
            )
        );

        const pollingToken = `${Date.now()}-${Math.random()}`;
        yieldPollingTokenRef.current = pollingToken;

        const poll = async () => {
            while (yieldPollingTokenRef.current === pollingToken) {
                try {
                    const conversationResponse = await fetch(`/api/conversations/${targetConversationId}`);
                    if (conversationResponse.ok) {
                        const latestConversation = await conversationResponse.json();
                        if (latestConversation?.active_job_id) {
                            clearYieldPolling();
                            updateConversationActivity(targetConversationId, {
                                activeJobId: latestConversation.active_job_id,
                                isYielding: false,
                                isRunning: true,
                                ensureExists: true,
                                provider: latestConversation.ai_provider || finalProvider,
                            });
                            connectToJobStream(latestConversation.active_job_id, tempAssistantMessageId, finalProvider, onDone, 0, targetConversationId);
                            return;
                        }
                    }

                    const messagesResponse = await fetch(`/api/conversations/${targetConversationId}/messages`);
                    if (messagesResponse.ok) {
                        const serverMessages = await messagesResponse.json();
                        const latestAssistant = Array.isArray(serverMessages)
                            ? [...serverMessages].reverse().find((msg: any) => msg?.role === "assistant" || msg?.role === "summary")
                            : null;

                        if (latestAssistant?.id && latestAssistant.id !== lastAssistantMessageIdBeforeSendRef.current) {
                            clearYieldPolling();
                            updateConversationActivity(targetConversationId, {
                                activeJobId: null,
                                isYielding: false,
                                isRunning: false,
                            });
                            setMessages((prev) =>
                                prev.map((msg) =>
                                    msg.id === tempAssistantMessageId
                                        ? {
                                            ...msg,
                                            id: latestAssistant.id,
                                            role: latestAssistant.role,
                                            content: latestAssistant.content || msg.content,
                                            model: latestAssistant.model || msg.model,
                                            sources: latestAssistant.sources || msg.sources,
                                            wasGrounded: latestAssistant.was_grounded === 1,
                                            thoughts: latestAssistant.thoughts || msg.thoughts,
                                            thinking_duration: latestAssistant.thinking_duration || msg.thinking_duration,
                                            status: undefined,
                                        }
                                        : msg
                                )
                            );
                            setStreamingMessageId(null);
                            setStreamingTimeline([]);
                            setActiveToolJobs([]);
                            setIsLoading(false);
                            onDone?.();
                            return;
                        }
                    }
                } catch {
                    // keep polling
                }

                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        };

        void poll();
    }, [clearYieldPolling, connectToJobStream, setIsLoading, setMessages, updateConversationActivity]);

    startYieldPollingRef.current = startYieldPolling;

    const sendMessage = useCallback(async (options?: {
        message?: string;
        provider?: string;
        skipProviderUpdate?: boolean;
        endpoint?: string;
        thinking?: boolean;
    }) => {
        const finalInput = options?.message || input.trim();
        const finalProvider = options?.provider || aiProvider;
        const finalThinking = options?.thinking !== undefined ? options.thinking : thinking;
        const endpoint = options?.endpoint || "/api/chat";
        const skipProviderUpdate = options?.skipProviderUpdate;

        if (!finalInput || isLoading) return;
        clearYieldPolling();
        lastAssistantMessageIdBeforeSendRef.current = getLatestAssistantId(
            messages.filter((msg) => !msg.id.startsWith('temp-'))
        );

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const isSummary = endpoint === "/api/summarize";
        const isUserTyping = !options?.message && endpoint === "/api/chat";
        lastMessageSourceRef.current = isUserTyping ? 'user' : 'action';

        if (isUserTyping) {
            lastSentMessageRef.current = finalInput;
        } else {
            lastSentMessageRef.current = "";
        }

        const userMessage = finalInput;
        const currentImage = imageAttachment ? {
            mimeType: imageAttachment.mimeType,
            base64: imageAttachment.base64,
        } : null;
        const currentFiles = fileAttachments.map(f => ({
            uri: f.uri,
            mimeType: f.mimeType,
            fileName: f.fileName,
            uploadedAt: f.uploadedAt,
            expirationTime: f.expirationTime,
        }));

        if (!options?.message) {
            setInput("");
            clearImageAttachment();
            clearFileAttachments();
        }
        setIsLoading(true);
        streamingConversationIdRef.current = null;

        const tempUserMessageId = `temp-user-${Date.now()}`;
        const tempAssistantMessageId = `temp-assistant-${Date.now()}`;
        const fileCount = currentFiles.length;
        const messageAttachments = currentFiles.length > 0
            ? currentFiles.map(f => ({ name: f.fileName, uri: f.uri, mime_type: f.mimeType }))
            : undefined;
        let messagesAdded = 0;

        if (!isSummary) {
            setMessages((prev) => [
                ...prev,
                { id: tempUserMessageId, role: "user" as const, content: userMessage, fileCount, attachments: messageAttachments, created_at: new Date().toISOString() },
            ]);
            messagesAdded++;
        }

        const currentModelName = modelsConfig.models.find((m: any) => m.id === finalProvider)?.name ?? finalProvider;
        setMessages((prev) => [
            ...prev,
            {
                id: tempAssistantMessageId,
                role: isSummary ? "summary" : "assistant",
                content: "",
                model: currentModelName,
                wasGrounded: false,
                created_at: new Date().toISOString()
            },
        ]);
        messagesAdded++;
        messagesAddedRef.current = messagesAdded;

        setStreamingMessageId(tempAssistantMessageId);
        timelineCounterRef.current = 0;
        setStreamingTimeline([]);
        setStreamingThoughts("");
        setThinkingStartTime(null);
        setThinkingDuration(null);
        setFinalThoughts("");
        setActiveToolJobs([]);

        let location: string | undefined;

        try {
            if (locationContext.isTrackingEnabled) {
                location = await locationContext.getLocation((status: string) => {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === tempAssistantMessageId
                                ? { ...msg, status }
                                : msg
                        )
                    );
                });
            }
        } catch (e) {
            console.log("Location fetch skipped:", e);
        }

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: userMessage,
                    conversationId: conversationId,
                    grounding: false,
                    thinking: finalThinking,
                    mode: responseMode,
                    folderId: defaultFolderId,
                    image: currentImage,
                    files: currentFiles.length > 0 ? currentFiles : undefined,
                    aiProvider: finalProvider,
                    location,
                    skipProviderUpdate,
                    documentIds: documentContexts.map(doc => doc.id),
                    contentContexts: contentContexts.length > 0
                        ? contentContexts.map((ctx) => ({ title: ctx.title, content: ctx.content }))
                        : undefined,
                    appId: appId || undefined,
                }),
                signal: abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const result = await response.json();
            const targetConversationId = result.conversationId || conversationId;

            if (result.isNewConversation && result.conversationId) {
                isNewConversationRef.current = true;
                setConversationId(result.conversationId);
                streamingConversationIdRef.current = result.conversationId;
                if (onConversationCreated) {
                    onConversationCreated(result.conversationId);
                }
            }

            if (result.jobId) {
                updateConversationActivity(targetConversationId, {
                    activeJobId: result.jobId,
                    isYielding: false,
                    isRunning: true,
                    ensureExists: true,
                    provider: finalProvider,
                });
                connectToJobStream(result.jobId, tempAssistantMessageId, finalProvider, undefined, 0, targetConversationId);
            } else {
                throw new Error("No job ID returned");
            }
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.error("Failed to send message:", error);
            }
            updateConversationActivity(streamingConversationIdRef.current || conversationId, {
                activeJobId: null,
                isYielding: false,
                isRunning: false,
            });
            setStreamingMessageId(null);
            setStreamingTimeline([]);
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    }, [input, isLoading, conversationId, thinking, responseMode, aiProvider, defaultFolderId, onConversationCreated, setInput, setIsLoading, imageAttachment, clearImageAttachment, fileAttachments, clearFileAttachments, documentContexts, contentContexts, connectToJobStream, modelsConfig.models, locationContext, setMessages, setConversationId, clearYieldPolling, messages, updateConversationActivity]);

    const stopStreaming = useCallback(async () => {
        setIsCancelling(true);
        clearYieldPolling();
        const countToRemove = messagesAddedRef.current || 2;
        const isActionMessage = lastMessageSourceRef.current === 'action';
        let removedOptimistically = false;

        if (lastMessageSourceRef.current === 'user' && lastSentMessageRef.current) {
            setInput(lastSentMessageRef.current);
        }

        if (streamingMessageId) {
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === streamingMessageId
                        ? { ...msg, status: 'Cancelling' }
                        : msg
                )
            );
        }

        // For action-triggered flows (verify/summarize/etc.), remove optimistic placeholders
        // immediately so the UI reflects cancellation without waiting for /stop latency.
        if (isActionMessage) {
            setMessages(prev => prev.slice(0, -countToRemove));
            removedOptimistically = true;
        }

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (currentJobIdRef.current) {
            try {
                await fetch(`/api/jobs/${currentJobIdRef.current}/stop`, { method: 'POST' });
            } catch {
            }
            currentJobIdRef.current = null;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        if (!removedOptimistically) {
            setMessages(prev => prev.slice(0, -countToRemove));
        }

        if (isNewConversationRef.current) {
            setConversationId(null);
            onConversationReset?.();
            isNewConversationRef.current = false;
        }

        updateConversationActivity(streamingConversationIdRef.current || conversationId, {
            activeJobId: null,
            isYielding: false,
            isRunning: false,
        });

        setIsLoading(false);
        setIsCancelling(false);
        setStreamingMessageId(null);
        setStreamingTimeline([]);
        setStreamingThoughts("");
        setActiveToolJobs([]);
        streamingConversationIdRef.current = null;

        if (lastMessageSourceRef.current === 'user' && lastSentMessageRef.current) {
            setTimeout(() => {
                focusInputRef.current?.();
            }, 0);
        }
    }, [setIsLoading, setIsCancelling, setInput, setMessages, focusInputRef, streamingMessageId, onConversationReset, setConversationId, clearYieldPolling, updateConversationActivity, conversationId]);

    useEffect(() => {
        sendMessageRef.current = sendMessage;
        stopStreamingRef.current = stopStreaming;
        return () => {
            sendMessageRef.current = null;
            stopStreamingRef.current = null;
        };
    }, [sendMessage, stopStreaming, sendMessageRef, stopStreamingRef]);

    useEffect(() => {
        return () => {
            backgroundYieldPollingRef.current = null;
            clearYieldPolling();
        };
    }, [clearYieldPolling]);

    const wasLoadingRef = useRef(false);
    useEffect(() => {
        if (isLoading) {
            wasLoadingRef.current = true;
        } else if (wasLoadingRef.current) {
            setStreamingMessageId(null);
        }
    }, [isLoading]);

    return {
        streamingMessageId,
        streamingThoughts,
        streamingTimeline,
        thinkingStartTime,
        thinkingDuration,
        finalThoughts,
        activeToolJobs,
        expandedThoughts,
        setExpandedThoughts,
        sendMessage,
        stopStreaming,
    };
}
