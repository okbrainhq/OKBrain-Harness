"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChatContext } from "../context/ChatContext";
import { FileText } from "lucide-react";

import MoveToFolderModal from "./MoveToFolderModal";
import ShareModal from "./ShareModal";
import { HighlightData } from "./HighlightsSection";

import ChatHeader from "./ChatHeader";
import ChatEmptyState from "./ChatEmptyState";
import ChatActions from "./ChatActions";
import ChatMessage from "./ChatMessage";

import { useChatStreaming } from "../../hooks/useChatStreaming";

import chatStyles from "./ChatView.module.css";
import "./primitive/ContentStyles.module.css";
import "./Markdown.module.css";
import "highlight.js/styles/vs2015.css";

export interface MessageAttachment {
  name: string;
  uri: string;
  mime_type: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "summary";
  content: string;
  model?: string;
  sources?: string;
  fileCount?: number;
  attachments?: MessageAttachment[];
  wasGrounded?: boolean;
  status?: string;
  thoughts?: string;
  thinking_duration?: number;
  error?: string;
  feedback?: number | null;
  created_at?: string;
  tool_jobs?: ToolJobData[];
}

export interface StreamingTimelineItem {
  id: string;
  kind: "output" | "thought" | "status";
  text: string;
}

export interface ToolJobData {
  id: string;
  job_id: string;
  message_id?: string | null;
  tool_name: string;
  metadata?: string | null;
  state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout';
  output?: string | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FileAttachment {
  id: string;
  message_id: string;
  file_uri: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
  created_at: string;
}

export interface Conversation {
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

interface ChatViewProps {
  readOnly?: boolean;
  initialConversationId?: string | null;
  initialMessages?: Message[];
  initialConversation?: Conversation | null;
  onConversationCreated?: (id: string) => void;
  onConversationReset?: () => void;
  initialDocumentContexts?: { id: string; title: string }[] | null;
  initialContentContexts?: { title: string; content: string; sharedLinkId?: string }[] | null;
  initialAppId?: string | null;
  initialHighlightsData?: HighlightData | null;
  initialActiveJobId?: string | null;
  initialStreamingContent?: string;
  initialStreamingThoughts?: string;
  initialStreamingStatus?: string;
  initialStreamingRole?: 'assistant' | 'summary';
  initialLastSeq?: number;
  initialStreamingTimeline?: StreamingTimelineItem[];
  initialYieldWaiting?: boolean;
  initialVerifyModel?: string | null;
  initialToolJobs?: ToolJobData[];
}

export default function ChatView({
  readOnly = false,
  initialConversationId = null,
  initialMessages = [],
  initialConversation = null,
  onConversationCreated,
  onConversationReset,
  initialDocumentContexts = [],
  initialContentContexts = [],
  initialAppId = null,
  initialHighlightsData,
  initialActiveJobId = null,
  initialStreamingContent = "",
  initialStreamingThoughts = "",
  initialStreamingStatus = "",
  initialStreamingRole = 'assistant',
  initialLastSeq = 0,
  initialStreamingTimeline = [],
  initialYieldWaiting = false,
  initialVerifyModel = null,
  initialToolJobs = [],
}: ChatViewProps) {
  const {
    modelsConfig,
    setConversations, defaultFolderId, folders, moveConversationToFolder, setDeleteConfirm, setRenameConfirm,
    input, setInput, isLoading, setIsLoading, isCancelling, setIsCancelling, thinking, responseMode, setResponseMode, aiProvider, setAiProvider, sendMessageRef,
    stopStreamingRef, focusInputRef,
    imageAttachment, clearImageAttachment,
    fileAttachments, clearFileAttachments,
    conversations,
    setIsConversationReadOnly,
    location: locationContext
  } = useChatContext();

  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldScroll = searchParams.get('scroll') === 'true';

  const initialStreamingMessageId = initialActiveJobId
    ? `temp-assistant-resume-${initialActiveJobId}`
    : (initialYieldWaiting && initialConversationId ? `temp-assistant-yield-wait-${initialConversationId}` : null);
  const initialProvider = initialConversation?.ai_provider || modelsConfig.defaultModelId;
  const initialModelName = modelsConfig.models.find((m: any) => m.id === initialProvider)?.name ?? initialProvider;
  const defaultStatus = initialStreamingMessageId
    ? (initialStreamingStatus || (initialStreamingRole === 'summary' ? 'Summarizing' : `Talking to ${initialModelName.split(' ')[0]}`))
    : '';

  const computedInitialMessages = initialStreamingMessageId
    ? [
      ...initialMessages,
      {
        id: initialStreamingMessageId!,
        role: initialStreamingRole,
        content: initialStreamingContent || '',
        thoughts: initialStreamingThoughts || undefined,
        model: initialModelName,
        wasGrounded: false,
        status: defaultStatus,
      },
    ]
    : initialMessages;

  const [messages, setMessages] = useState<Message[]>(computedInitialMessages);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation);
  const [conversationAttachments, setConversationAttachments] = useState<FileAttachment[]>([]);
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
  const streamingMessageRef = useRef<HTMLDivElement>(null);
  const thoughtsContainerRef = useRef<HTMLDivElement>(null);
  const lastInitializedIdRef = useRef<string | null>(null);

  const {
    streamingMessageId,
    streamingThoughts,
    streamingTimeline,
    thinkingDuration,
    finalThoughts,
    activeToolJobs,
    expandedThoughts,
    setExpandedThoughts,
    sendMessage,
  } = useChatStreaming({
    messages, setMessages,
    conversationId, setConversationId,
    conversation, setConversation,
    modelsConfig, setConversations,
    input, setInput,
    isLoading, setIsLoading,
    isCancelling, setIsCancelling,
    thinking, responseMode: responseMode as "quick" | "detailed",
    aiProvider, defaultFolderId,
    imageAttachment, clearImageAttachment,
    fileAttachments, clearFileAttachments,
    onConversationCreated, onConversationReset,
    documentContexts, contentContexts, locationContext, appId: initialAppId,
    sendMessageRef, stopStreamingRef, focusInputRef,
    streamingMessageRef, messagesEndRef, messagesContainerRef, thoughtsContainerRef,
    initialStreamingMessageId, initialStreamingThoughts,
    initialActiveJobId, initialLastSeq, initialStreamingTimeline, initialYieldWaiting,
    initialToolJobs,
  });

  const handleVerifyModelChange = useCallback((model: string) => {
    setVerifyModel(model);
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'verify:model', value: model }),
    }).catch(() => { });
  }, []);

  // Set read-only mode
  useEffect(() => {
    setIsConversationReadOnly(readOnly);
    return () => setIsConversationReadOnly(false);
  }, [readOnly, setIsConversationReadOnly]);

  useEffect(() => {
    if (initialConversationId !== lastInitializedIdRef.current) {
      lastInitializedIdRef.current = initialConversationId;
      setConversationId(initialConversationId);
      setMessages(computedInitialMessages);
      setConversation(initialConversation);

      if (initialConversation) {
        if (initialConversation.ai_provider) {
          setAiProvider(initialConversation.ai_provider);
        }
        if (initialConversation.response_mode) {
          setResponseMode(initialConversation.response_mode as 'quick' | 'detailed');
        }
      }

      if (initialMessages.length > 0) {
        if (searchParams.get('restoreScroll') === 'true' && initialConversationId) {
          const savedPos = localStorage.getItem(`scrollPos:chat:${initialConversationId}`);
          if (savedPos) {
            setTimeout(() => {
              const container = messagesContainerRef.current;
              if (container) container.scrollTop = parseInt(savedPos, 10);
            }, 100);
          }
        } else if (shouldScroll) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
          }, 100);
        }
      }
    }
  }, [initialConversationId, initialMessages, initialConversation, setAiProvider, setResponseMode, shouldScroll, searchParams, computedInitialMessages]);

  useEffect(() => {
    if (conversationId) {
      loadAttachments();
    }
  }, [conversationId]);

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

  const loadAttachments = async () => {
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/attachments`);
      const data = await res.json();
      if (data.success && data.attachments) {
        setConversationAttachments(data.attachments);
      }
    } catch {
    }
  };

  useEffect(() => {
    if (initialDocumentContexts && initialDocumentContexts.length > 0) {
      setDocumentContexts(initialDocumentContexts);
    }
  }, [initialDocumentContexts]);

  useEffect(() => {
    if (initialContentContexts && initialContentContexts.length > 0) {
      setContentContexts(initialContentContexts);
    }
  }, [initialContentContexts]);

  const handleFeedback = useCallback(async (messageId: string, feedback: number | null) => {
    setMessages((prev) => prev.map(msg =>
      msg.id === messageId ? { ...msg, feedback } : msg
    ));

    try {
      const res = await fetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });

      if (!res.ok) {
        throw new Error("Failed to save feedback");
      }
    } catch (error) {
      setMessages((prev) => prev.map(msg =>
        msg.id === messageId ? { ...msg, feedback: prev.find(m => m.id === messageId)?.feedback } : msg
      ));
    }
  }, [setMessages]);

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
        } else if (item.type === 'doc' && item.id) {
          router.push(`/doc/${item.id}?restoreScroll=true`);
          return;
        }
      } catch { }
    }
    if (conversations.length > 0) {
      const latest = [...conversations].sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )[0];
      router.push(`/chat/${latest.id}?scroll=true`);
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
        <div className={chatStyles.documentContextIcon}>
          <FileText size={20} />
        </div>
        <div className={chatStyles.documentContextContent}>
          <div className={chatStyles.documentContextLabel}>
            Document Context
          </div>
          <div className={chatStyles.documentContextTitle}>
            {doc.title}
          </div>
        </div>
      </div>
    ));
  };

  const renderContentContext = () => {
    if (!contentContexts || contentContexts.length === 0) return null;
    return contentContexts.map((contentContext, index) => (
      <div
        key={`${contentContext.title}-${index}`}
        className={`document-context-card ${chatStyles.documentContextCard} ${!contentContext.sharedLinkId ? chatStyles.documentContextCardStatic : ''}`}
        onClick={contentContext.sharedLinkId ? () => router.push(`/s/${contentContext.sharedLinkId}`) : undefined}
      >
        <div className={chatStyles.documentContextIcon}>
          <FileText size={20} />
        </div>
        <div className={chatStyles.documentContextContent}>
          <div className={chatStyles.documentContextLabel}>
            Shared Content
          </div>
          <div className={chatStyles.documentContextTitle}>
            {contentContext.title}
          </div>
        </div>
      </div>
    ));
  };

  return (
    <div className="messages-container" ref={messagesContainerRef}>
      {conversation && messages.length > 0 && (
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
      <div className={`messages-wrapper ${messages.length === 0 ? chatStyles.messagesWrapperEmpty : ''}`}>
        {renderDocumentContext()}
        {renderContentContext()}
        {messages.length === 0 ? (
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
            {messages.map((message, idx) => {
              const prevMessage = idx > 0 ? messages[idx - 1] : undefined;
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  prevMessage={prevMessage}
                  isFirst={idx === 0}
                  isStreaming={message.id === streamingMessageId}
                  streamingThoughts={streamingThoughts}
                  finalThoughts={finalThoughts}
                  thinkingDuration={thinkingDuration}
                  streamingTimeline={message.id === streamingMessageId ? streamingTimeline : []}
                  expandedThoughts={expandedThoughts}
                  onToggleThoughts={(id) => {
                    const newSet = new Set(expandedThoughts);
                    newSet.has(id) ? newSet.delete(id) : newSet.add(id);
                    setExpandedThoughts(newSet);
                  }}
                  onFeedback={handleFeedback}
                  streamingMessageRef={message.id === streamingMessageId ? streamingMessageRef : undefined}
                  thoughtsContainerRef={thoughtsContainerRef}
                  attachments={conversationAttachments.filter(a => a.message_id === message.id)}
                  activeToolJobs={message.id === streamingMessageId ? activeToolJobs : []}
                />
              );
            })}
            {messages.length > 0 && !readOnly && (
              <div style={isLoading || streamingMessageId ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
                <ChatActions
                  onSummarize={handleSummarize}
                  onVerify={handleVerify}
                  verifyModel={verifyModel}
                  onVerifyModelChange={handleVerifyModelChange}
                  showVerifyMenu={showVerifyMenu}
                  setShowVerifyMenu={setShowVerifyMenu}
                />
              </div>
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
