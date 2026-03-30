"use client";

import { ReactNode, useEffect, useRef, useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { useChatContext } from "../context/ChatContext";
import Select from "./primitive/Select";
import { Checkbox } from "./primitive/Checkbox";
import {
  Menu,
  RotateCw,
  X,
  Paperclip,
  Send,
  FileText,
  Square
} from "lucide-react";
import BackgroundTasksTab from "./BackgroundTasksTab";
import "./ChatLayout.module.css";

interface ChatLayoutProps {
  children: ReactNode;
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    modelsConfig, getCurrentModel,
    deleteConfirm, setDeleteConfirm, deleteItem, setSidebarOpen,
    renameConfirm, setRenameConfirm, renameItem,
    input, setInput, isLoading, isCancelling, thinking, setThinking, responseMode, setResponseMode, aiProvider, setAiProvider, saveAiProviderPreference, sendMessageRef,
    stopStreamingRef, focusInputRef,
    imageAttachment, setImageAttachment, clearImageAttachment,
    fileAttachments, addFileAttachment, removeFileAttachment,
    yieldedToolJobs,
    isConversationReadOnly,
  } = useChatContext();
  const currentModel = getCurrentModel();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Ctrl+A / Cmd+A to select all
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      // Explicitly select all text in the textarea
      if (textareaRef.current) {
        e.preventDefault();
        textareaRef.current.setSelectionRange(0, textareaRef.current.value.length);
      }
      return;
    }

    // Enter without Shift sends the message
    // Shift+Enter allows new line (default behavior)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  };

  const handleSend = () => {
    sendMessageRef.current?.();
    // Reset textarea height after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const focusInput = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    }
  }, []);

  useEffect(() => {
    focusInputRef.current = focusInput;
    return () => {
      focusInputRef.current = null;
    };
  }, [focusInput, focusInputRef]);

  // iOS Safari: adjust fixed input position when virtual keyboard opens/closes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleViewportResize = () => {
      const vv = window.visualViewport!;
      const keyboardHeight = window.innerHeight - vv.height;
      document.documentElement.style.setProperty(
        '--keyboard-inset-height',
        `${Math.max(0, keyboardHeight)}px`
      );
    };

    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', handleViewportResize);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      window.visualViewport?.removeEventListener('scroll', handleViewportResize);
    };
  }, []);

  // Register service worker and Reset textarea height when input is cleared
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
          console.log('SW registered: ', registration);
        }).catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
      });
    }

    if (!input && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input]);

  const [uploadingCount, setUploadingCount] = useState(0);
  const isUploading = uploadingCount > 0;
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const validFileTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/css',
    'text/javascript',
    'application/json',
    'application/xml',
  ];

  const uploadFile = useCallback(async (file: File) => {
    if (!validFileTypes.includes(file.type)) {
      alert('Please select a valid file (images, PDF, or text files)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('File must be smaller than 10MB');
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    setUploadingCount(c => c + 1);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', aiProvider);

      const response = await fetch('/api/ai/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();

      addFileAttachment({
        uri: data.file.uri,
        name: data.file.name,
        mimeType: data.file.mimeType,
        sizeBytes: data.file.sizeBytes,
        fileName: data.file.fileName,
        uploadedAt: data.file.uploadedAt,
        expirationTime: data.file.expirationTime,
        previewUrl: file.type.startsWith('image/') ? previewUrl : undefined,
      });
    } catch (error: any) {
      console.error('File upload failed:', error);
      alert(`Upload failed: ${error.message}`);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setUploadingCount(c => c - 1);
    }
  }, [aiProvider, addFileAttachment]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = '';
  }, [uploadFile]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentModel?.capabilities.fileUpload) return;
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragOver(true);
    }
  }, [currentModel]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    if (!currentModel?.capabilities.fileUpload) return;

    const files = Array.from(e.dataTransfer.files).filter(f => validFileTypes.includes(f.type));
    if (files.length === 0) return;

    for (const file of files) {
      await uploadFile(file);
    }
  }, [currentModel, uploadFile]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!currentModel?.capabilities.fileUpload) return;

    const files = Array.from(e.clipboardData.files).filter(f => validFileTypes.includes(f.type));
    if (files.length === 0) return;

    e.preventDefault();
    for (const file of files) {
      await uploadFile(file);
    }
  }, [currentModel, uploadFile]);

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const confirmDelete = async () => {
    const itemId = deleteConfirm?.id;
    const itemType = deleteConfirm?.type;
    await deleteItem();

    // If we deleted the current conversation or document, redirect to home
    if (itemType === 'conversation' && pathname === `/chat/${itemId}`) {
      router.push('/');
    }
    if (itemType === 'document' && pathname === `/doc/${itemId}`) {
      router.push('/');
    }
  };

  const [renameInput, setRenameInput] = useState('');

  useEffect(() => {
    if (renameConfirm) {
      setRenameInput(renameConfirm.title);
    }
  }, [renameConfirm]);

  // Check if we're viewing a document, file browser, app, or the memory page (should hide chat input)
  const isDocumentPage = pathname.startsWith('/doc/');
  const isFileBrowserPage = pathname.startsWith('/filebrowser/');
  const isAppPage = pathname.startsWith('/app/');
  const isMemoryPage = pathname === '/me';

  const shouldHideInput = isDocumentPage || isFileBrowserPage || isAppPage || isMemoryPage;

  // Extract current conversation ID from pathname and filter yielded jobs
  const currentConversationId = pathname.startsWith('/chat/') ? pathname.split('/chat/')[1]?.split('?')[0] : undefined;
  const currentYieldedToolJobs = currentConversationId
    ? yieldedToolJobs.filter(j => j.conversationId === currentConversationId)
    : [];

  return (
    <div className="app-container">
      <Sidebar />

      {/* Main content */}
      <main className="main-content">
        {/* Mobile header */}
        <div className="mobile-header">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={24} />
          </button>
          <a href="/" className="logo" style={{ textDecoration: 'none' }}>
            <div className="logo-icon">
              <img src="/okbrain-icon.png" alt="OKBrain" style={{ width: '100%', height: '100%', borderRadius: '8px' }} />
            </div>
            OKBrain
          </a>
          <button
            className="reload-btn"
            onClick={() => window.location.reload()}
            title="Reload app"
          >
            <RotateCw size={20} />
          </button>
        </div>

        {children}

        {/* Input - visible only for chat pages, not document or memory pages */}
        {!shouldHideInput && (
          <div
            className={`input-container ${isDragOver ? 'drag-over' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {currentYieldedToolJobs.length > 0 && (
              <div className="background-tasks-section">
                <BackgroundTasksTab jobs={currentYieldedToolJobs} />
              </div>
            )}
            <div className="grounding-control">
              <div className="control-item">
                <label>Model:</label>
                <Select
                  id="ai-provider"
                  value={aiProvider}
                  onChange={(v) => { setAiProvider(v); saveAiProviderPreference(v); }}
                  options={modelsConfig.models.map(m => ({ value: m.id, label: m.name }))}
                  disabled={isLoading}
                />
              </div>
              <div className="controls-right">
                <div className="control-item">
                  <label>Mode:</label>
                  <Select
                    id="response-mode"
                    value={responseMode}
                    onChange={(v) => setResponseMode(v as 'quick' | 'detailed')}
                    options={[
                      { value: 'quick', label: 'Quick' },
                      { value: 'detailed', label: 'Detailed' }
                    ]}
                    disabled={isLoading}
                  />
                </div>
                <Checkbox
                  checked={thinking}
                  onChange={(e) => setThinking(e.target.checked)}
                  disabled={isLoading}
                  label="THINK"
                  className="grounding-checkbox-primitive"
                />
              </div>
            </div>

            {/* File attachments preview */}
            {fileAttachments.length > 0 && (
              <div className="file-attachments-preview">
                {fileAttachments.map((file) => (
                  <div key={file.uri} className="file-attachment-item">
                    {file.previewUrl ? (
                      <img src={file.previewUrl} alt={file.fileName} />
                    ) : (
                      <div className="file-icon">
                        <FileText size={32} />
                      </div>
                    )}
                    <div className="file-info">
                      <div className="file-name">{file.fileName}</div>
                      <div className="file-size">{(file.sizeBytes / 1024).toFixed(1)} KB</div>
                    </div>
                    <button
                      className="file-remove-btn"
                      onClick={() => removeFileAttachment(file.uri)}
                      disabled={isLoading}
                      aria-label="Remove file"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload progress indicator */}
            {isUploading && (
              <div className="upload-progress">
                <div className="upload-progress-spinner"></div>
                <div className="upload-progress-text">
                  {uploadingCount > 1 ? `Uploading ${uploadingCount} files...` : 'Uploading file...'}
                </div>
              </div>
            )}

            <div className="input-wrapper">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,text/html,text/css,text/javascript,application/json,application/xml,.txt,.md,.csv,.html,.css,.js,.json,.xml"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              {currentModel?.capabilities.fileUpload && (
                <button
                  className={`image-upload-btn ${isUploading ? 'uploading' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isUploading}
                  title={isUploading ? 'Uploading...' : 'Attach file'}
                >
                  {isUploading ? (
                    <span className="upload-spinner"></span>
                  ) : (
                    <Paperclip size={20} />
                  )}
                </button>
              )}
              <textarea
                ref={textareaRef}
                className="chat-input"
                style={{ paddingLeft: currentModel?.capabilities.fileUpload ? '0px' : '16px' }}
                value={isConversationReadOnly ? '' : input}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isConversationReadOnly ? "This is an older conversation (read-only)" : "Ask me anything..."}
                rows={1}
                disabled={isLoading || isCancelling || isConversationReadOnly}
              />
              {isConversationReadOnly ? null : isLoading && !isCancelling ? (
                <button
                  className="stop-btn"
                  onClick={() => stopStreamingRef.current?.()}
                  title="Stop generating"
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : isCancelling ? null : (
                <button
                  className="send-btn"
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  title="Send message"
                >
                  <Send size={18} />
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="delete-dialog-overlay" onClick={cancelDelete}>
          <div className="delete-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {deleteConfirm.type === 'folder' ? 'Folder' : deleteConfirm.type === 'document' ? 'Document' : 'Conversation'}</h3>
            <p>
              Are you sure you want to delete &quot;{deleteConfirm.title}&quot;?
              {deleteConfirm.type === 'folder' && ' Items in this folder will be moved to uncategorized.'}
              {' '}This action cannot be undone.
            </p>
            <div className="delete-dialog-actions">
              <button className="delete-btn-cancel" onClick={cancelDelete}>
                Cancel
              </button>
              <button className="delete-btn-confirm" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {renameConfirm && (
        <div className="rename-dialog-overlay" onClick={() => setRenameConfirm(null)}>
          <div className="rename-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Rename {renameConfirm.type === 'document' ? 'Document' : 'Conversation'}</h3>
            <input
              type="text"
              className="rename-input"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameInput.trim()) {
                  renameItem(renameInput.trim());
                }
                if (e.key === 'Escape') {
                  setRenameConfirm(null);
                }
              }}
            />
            <div className="rename-dialog-actions">
              <button className="rename-btn-cancel" onClick={() => setRenameConfirm(null)}>
                Cancel
              </button>
              <button
                className="rename-btn-confirm"
                onClick={() => renameInput.trim() && renameItem(renameInput.trim())}
                disabled={!renameInput.trim()}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

