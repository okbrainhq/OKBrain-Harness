"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useChatContext } from "../../../context/ChatContext";
import TiptapEditor from "../../../components/TiptapEditor";
import { Sparkles, History, MessageSquare, Clock, ArrowRight, Printer, Share2, MoreVertical, Camera, Trash2, RotateCcw, Plus, FolderOpen } from "lucide-react";
import MoveToFolderModal from "../../../components/MoveToFolderModal";
import { Button } from "../../../components/primitive/Button";
import { Modal } from "../../../components/primitive/Modal";
import "../../../components/DocumentEditor.module.css";
import ShareModal from "../../../components/ShareModal";

interface Document {
  id: string;
  title: string;
  content: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface SnapshotListItem {
  id: string;
  message: string;
  created_at: string;
}

interface SnapshotDetail {
  id: string;
  document_id: string;
  user_id: string;
  message: string;
  title: string;
  content: string;
  created_at: string;
}

export default function DocPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const documentId = params.id as string;
  const { setDocuments, folders, moveDocumentToFolder, setDeleteConfirm } = useChatContext();
  const containerRef = useRef<HTMLDivElement>(null);

  const [document, setDocument] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [editorKey, setEditorKey] = useState(0); // Key to force re-mount editor
  const [pastConversations, setPastConversations] = useState<any[]>([]);
  const [showPastConversations, setShowPastConversations] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalType, setShareModalType] = useState<'document' | 'snapshot'>('document');
  const [shareModalResourceId, setShareModalResourceId] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false);

  // Snapshot state
  const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [showCreateSnapshotModal, setShowCreateSnapshotModal] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotDetail | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load document
  useEffect(() => {
    if (documentId) {
      setIsPageLoading(true);
      setShowLoadingIndicator(false);

      // Only show loading indicator after 1 second delay
      const loadingTimer = setTimeout(() => {
        setShowLoadingIndicator(true);
      }, 1000);

      loadDocument().finally(() => {
        clearTimeout(loadingTimer);
        setIsPageLoading(false);
        setShowLoadingIndicator(false);
      });
    }
  }, [documentId]);

  // Track last opened item in localStorage
  useEffect(() => {
    if (documentId) {
      localStorage.setItem('lastOpenedItem', JSON.stringify({ type: 'doc', id: documentId }));
    }
  }, [documentId]);

  // Save scroll position on scroll (debounced) and restore on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !documentId) return;

    // Restore scroll position if requested
    const restoreScroll = searchParams.get('restoreScroll') === 'true';
    if (restoreScroll) {
      const savedPos = localStorage.getItem(`scrollPos:doc:${documentId}`);
      if (savedPos) {
        setTimeout(() => {
          container.scrollTop = parseInt(savedPos, 10);
        }, 100);
      }
    }

    let timeout: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        localStorage.setItem(`scrollPos:doc:${documentId}`, String(container.scrollTop));
      }, 300);
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      clearTimeout(timeout);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [documentId, searchParams]);

  const loadDocument = async (retries = 3) => {
    try {
      const res = await fetch(`/api/docs/${documentId}`);
      if (res.status === 404) {
        // Retry a few times in case of race condition with document creation
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
          return loadDocument(retries - 1);
        }
        router.push('/');
        return;
      }
      const data = await res.json();
      setDocument(data);
      setTitle(data.title);
      setContent(data.content);
      if (data.updated_at) {
        setLastSaved(new Date(data.updated_at));
      }
      setEditorKey((k) => k + 1); // Force editor re-mount with new content
    } catch (error) {
      console.error("Failed to load document:", error);
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return loadDocument(retries - 1);
      }
      router.push('/');
    }
  };

  // Debounced save
  const saveDocument = useCallback(async (newTitle: string, newContent: string) => {
    if (!documentId) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/docs/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, content: newContent }),
      });
      const updatedDoc = await res.json();
      setDocument(updatedDoc);
      setLastSaved(new Date());

      // Update the sidebar list
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === documentId ? { ...d, title: newTitle, content: newContent, updated_at: updatedDoc.updated_at } : d
        )
      );
    } catch (error) {
      console.error("Failed to save document:", error);
    } finally {
      setIsSaving(false);
    }
  }, [documentId, setDocuments]);

  // Debounce save on content/title change
  useEffect(() => {
    if (!document || (title === document.title && content === document.content)) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveDocument(title, content);
    }, 1000); // Auto-save after 1 second of inactivity

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [title, content, document, saveDocument]);

  // Save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Note: Can't await here, but the save will be triggered
      }
    };
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Focus the editor (will be handled by clicking)
    }
  };

  // Format last saved time
  const formatLastSaved = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Update relative time display every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshInterval(prev => prev + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadPastConversations = async () => {
    if (showPastConversations) {
      setShowPastConversations(false);
      return;
    }

    setShowSnapshots(false);
    setIsLoadingConversations(true);
    setShowPastConversations(true);
    try {
      const res = await fetch(`/api/docs/${documentId}/conversations`);
      const data = await res.json();
      setPastConversations(data);
    } catch (error) {
      console.error("Failed to load past conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const loadSnapshots = async () => {
    if (showSnapshots) {
      setShowSnapshots(false);
      return;
    }

    setShowPastConversations(false);
    setIsLoadingSnapshots(true);
    setShowSnapshots(true);
    try {
      const res = await fetch(`/api/docs/${documentId}/snapshots`);
      const data = await res.json();
      setSnapshots(data);
    } catch (error) {
      console.error("Failed to load snapshots:", error);
    } finally {
      setIsLoadingSnapshots(false);
    }
  };

  const refreshSnapshots = async () => {
    try {
      const res = await fetch(`/api/docs/${documentId}/snapshots`);
      const data = await res.json();
      setSnapshots(data);
    } catch (error) {
      console.error("Failed to refresh snapshots:", error);
    }
  };

  const handleCreateSnapshot = async () => {
    if (!snapshotMessage.trim()) return;

    setIsCreatingSnapshot(true);
    try {
      const res = await fetch(`/api/docs/${documentId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: snapshotMessage.trim() }),
      });
      if (res.ok) {
        setShowCreateSnapshotModal(false);
        setSnapshotMessage("");
        if (showSnapshots) {
          await refreshSnapshots();
        }
      }
    } catch (error) {
      console.error("Failed to create snapshot:", error);
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const openSnapshotDetail = async (snap: SnapshotListItem) => {
    try {
      const res = await fetch(`/api/docs/${documentId}/snapshots/${snap.id}`);
      const data = await res.json();
      setSelectedSnapshot(data);
    } catch (error) {
      console.error("Failed to load snapshot detail:", error);
    }
  };

  const handleRestoreSnapshot = async () => {
    if (!selectedSnapshot) return;
    if (!confirm("This will replace the current document content. Continue?")) return;

    try {
      const res = await fetch(`/api/docs/${documentId}/snapshots/${selectedSnapshot.id}/restore`, {
        method: "POST",
      });
      if (res.ok) {
        setSelectedSnapshot(null);
        await loadDocument();
      }
    } catch (error) {
      console.error("Failed to restore snapshot:", error);
    }
  };

  const handleDeleteSnapshot = async () => {
    if (!selectedSnapshot) return;
    if (!confirm("Delete this snapshot? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/docs/${documentId}/snapshots/${selectedSnapshot.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedSnapshot(null);
        if (showSnapshots) {
          await refreshSnapshots();
        }
      }
    } catch (error) {
      console.error("Failed to delete snapshot:", error);
    }
  };

  const handleShareSnapshot = () => {
    if (!selectedSnapshot) return;
    setShareModalType('snapshot');
    setShareModalResourceId(selectedSnapshot.id);
    setShowShareModal(true);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const handlePrint = () => {
    window.print();
  };

  // Listen for browser print events (CMD+P / Ctrl+P)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const beforePrint = () => {
      const titleInput = titleInputRef.current;
      if (titleInput) {
        const printTitle = window.document.createElement('div');
        printTitle.className = 'document-title-print';
        printTitle.setAttribute('data-print-title-element', 'true');
        printTitle.textContent = title || 'Untitled Document';
        printTitle.style.cssText = `
          font-size: 2.25rem;
          font-weight: 700;
          margin-bottom: 16px;
          line-height: 1.3;
          color: black;
          word-wrap: break-word;
          overflow-wrap: break-word;
          hyphens: none;
          white-space: pre-wrap;
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow: visible;
          text-overflow: clip;
          flex-shrink: 1;
          box-sizing: border-box;
        `;

        titleInput.style.display = 'none';
        titleInput.parentElement?.insertBefore(printTitle, titleInput);
      }
    };

    const afterPrint = () => {
      const titleInput = titleInputRef.current;
      if (titleInput) {
        titleInput.style.display = '';
        const printTitle = window.document.querySelector('[data-print-title-element="true"]');
        if (printTitle) {
          printTitle.remove();
        }
      }
    };

    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);

    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [title]);

  return (
    <div className="document-container" ref={containerRef}>
      {isPageLoading ? (
        showLoadingIndicator ? (
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <h2>Loading...</h2>
          </div>
        ) : null
      ) : (
        <div className="document-editor">
          <div className="document-header">
            <input
              ref={titleInputRef}
              type="text"
              className="document-title-input"
              value={title}
              onChange={handleTitleChange}
              onKeyDown={handleTitleKeyDown}
              placeholder="Untitled Document"
              data-print-title={title || "Untitled Document"}
            />
            {(lastSaved || isSaving) && (
              <div className="document-status">
                <Clock size={12} className="status-icon" />
                {isSaving ? (
                  <span className="saving-indicator">Saving...</span>
                ) : lastSaved ? (
                  <span className="saved-indicator">Saved {formatLastSaved(lastSaved)}</span>
                ) : null}
              </div>
            )}
            <div className="document-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Button
                onClick={() => router.push(`/?documentIds=${documentId}`)}
                className="ask-ai-button"
                icon={<Sparkles size={16} />}
                fullWidth={false}
              >
                Ask
              </Button>
              <Button
                onClick={loadPastConversations}
                className="past-chats-button"
                icon={<History size={16} />}
                fullWidth={false}
              >
                Chats
              </Button>
              <Button
                onClick={loadSnapshots}
                className="snapshots-button"
                icon={<Camera size={16} />}
                fullWidth={false}
              >
                Snapshots
              </Button>
              <div className="chat-menu-container" style={{ marginLeft: 'auto' }}>
                <button
                  className="chat-menu-button"
                  onClick={() => setShowMenu(!showMenu)}
                  aria-label="More options"
                >
                  <MoreVertical size={20} />
                </button>
                {showMenu && (
                  <>
                    <div
                      className="chat-menu-overlay"
                      onClick={() => setShowMenu(false)}
                    />
                    <div className="chat-menu-dropdown">

                      <button
                        className="chat-menu-item"
                        onClick={() => {
                          setShowMenu(false);
                          setShowMoveToFolderModal(true);
                        }}
                      >
                        <FolderOpen size={16} />
                        <span>Move</span>
                      </button>
                      <button
                        className="chat-menu-item"
                        onClick={() => {
                          setShowMenu(false);
                          setShareModalType('document');
                          setShareModalResourceId(documentId);
                          setShowShareModal(true);
                        }}
                      >
                        <Share2 size={16} />
                        <span>Share</span>
                      </button>
                      <button
                        className="chat-menu-item"
                        onClick={() => {
                          setShowMenu(false);
                          handlePrint();
                        }}
                      >
                        <Printer size={16} />
                        <span>Print</span>
                      </button>
                      <button
                        className="chat-menu-item chat-menu-item-danger"
                        onClick={() => {
                          setShowMenu(false);
                          setDeleteConfirm({ id: documentId, title: title || 'Untitled Document', type: 'document' });
                        }}
                      >
                        <Trash2 size={16} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {showPastConversations && (
            <div className="past-chats-panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <MessageSquare size={18} color="var(--text-muted)" />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Past Conversations</h3>
              </div>

              <div className="past-chats-list">
                {isLoadingConversations ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    Loading conversations...
                  </div>
                ) : pastConversations.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>
                    No past conversations for this document.
                  </div>
                ) : (
                  pastConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="past-chat-item"
                      onClick={() => router.push(`/chat/${conv.id}`)}
                    >
                      <MessageSquare size={16} color="var(--text-muted)" />
                      <div className="past-chat-title">{conv.title || 'Untitled Chat'}</div>
                      <div className="past-chat-date" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} />
                        {formatDate(conv.updated_at)}
                      </div>
                      <ArrowRight size={14} color="var(--text-muted)" />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {showSnapshots && (
            <div className="past-chats-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Camera size={18} color="var(--text-muted)" />
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Snapshots</h3>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setShowCreateSnapshotModal(true)}
                  icon={<Plus size={14} />}
                  fullWidth={false}
                  style={{ padding: '4px 10px', height: '30px', fontSize: '0.8rem' }}
                >
                  Add
                </Button>
              </div>

              <div className="past-chats-list">
                {isLoadingSnapshots ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    Loading snapshots...
                  </div>
                ) : snapshots.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>
                    No snapshots yet. Click "Add" to create one.
                  </div>
                ) : (
                  snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      className="past-chat-item"
                      onClick={() => openSnapshotDetail(snap)}
                    >
                      <Camera size={16} color="var(--text-muted)" />
                      <div className="past-chat-title">{snap.message}</div>
                      <div className="past-chat-date" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} />
                        {formatDate(snap.created_at)}
                      </div>
                      <ArrowRight size={14} color="var(--text-muted)" />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <TiptapEditor
            key={editorKey}
            value={content}
            onChange={handleContentChange}
            placeholder="Start writing..."
          />
        </div>
      )}

      {/* Create Snapshot Modal */}
      <Modal
        isOpen={showCreateSnapshotModal}
        onClose={() => { setShowCreateSnapshotModal(false); setSnapshotMessage(""); }}
        title="Create Snapshot"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setShowCreateSnapshotModal(false); setSnapshotMessage(""); }} fullWidth={false}>
              Cancel
            </Button>
            <Button onClick={handleCreateSnapshot} isLoading={isCreatingSnapshot} fullWidth={false} disabled={!snapshotMessage.trim()}>
              Create
            </Button>
          </div>
        }
      >
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Save the current state of this document with a description.
          </p>
          <input
            type="text"
            value={snapshotMessage}
            onChange={(e) => setSnapshotMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && snapshotMessage.trim()) handleCreateSnapshot(); }}
            placeholder="What changed?"
            className="snapshot-message-input"
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: '0.95rem',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>
      </Modal>

      {/* Snapshot Detail Modal */}
      <Modal
        isOpen={!!selectedSnapshot}
        onClose={() => setSelectedSnapshot(null)}
        title={selectedSnapshot?.message || 'Snapshot'}
        className="snapshot-modal"
      >
        <div style={{ padding: '20px' }}>
          {selectedSnapshot && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {new Date(selectedSnapshot.created_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                  }).replace(',', ' at')}
                  {selectedSnapshot.title !== title && (
                    <span style={{ marginLeft: '12px', paddingLeft: '12px', borderLeft: '1px solid var(--border)' }}>
                      Title: {selectedSnapshot.title}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    variant="secondary"
                    onClick={handleDeleteSnapshot}
                    fullWidth={false}
                    icon={<Trash2 size={14} />}
                    style={{ height: '32px', padding: '0 10px', fontSize: '0.8rem' }}
                  >
                    Delete
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleShareSnapshot}
                    fullWidth={false}
                    icon={<Share2 size={14} />}
                    style={{ height: '32px', padding: '0 10px', fontSize: '0.8rem' }}
                  >
                    Share
                  </Button>
                  <Button
                    onClick={handleRestoreSnapshot}
                    fullWidth={false}
                    icon={<RotateCcw size={14} />}
                    style={{ height: '32px', padding: '0 10px', fontSize: '0.8rem' }}
                  >
                    Restore
                  </Button>
                </div>
              </div>
              <div style={{
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '24px',
                maxHeight: '50vh',
                overflow: 'auto',
                background: 'var(--bg-secondary)',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)'
              }}>
                <TiptapEditor
                  value={selectedSnapshot.content}
                  editable={false}
                />
              </div>
            </>
          )}
        </div>
      </Modal>

      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        type={shareModalType}
        resourceId={shareModalResourceId}
      />

      <MoveToFolderModal
        isOpen={showMoveToFolderModal}
        onClose={() => setShowMoveToFolderModal(false)}
        currentFolderId={document?.folder_id ?? null}
        folders={folders}
        onMove={(folderId) => moveDocumentToFolder(documentId, folderId)}
      />
    </div>
  );
}
