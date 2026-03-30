"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useChatContext } from "../context/ChatContext";
import { Button } from "./primitive/Button";
import {
  Plus,
  MessageSquarePlus,
  FileText,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Trash2,
  X,
  MessageSquare,
  Pin,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  FilePlus,
  BrainCircuit,
  UserCircle,
  Search,
  LoaderCircle,
  FolderCode,
  AppWindow,
} from "lucide-react";
import "./Sidebar.module.css";

// Combined item type for sidebar
interface SidebarItem {
  id: string;
  title: string;
  folder_id?: string | null;
  updated_at: string;
  type: 'chat' | 'document' | 'filebrowser' | 'app';
  active_job_id?: string | null;
  is_running?: boolean;
  is_yielding?: boolean;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    conversations,
    documents,
    fileBrowsers,
    apps,
    folders,
    expandedFolders,
    defaultFolderId,
    sidebarOpen,
    sidebarCollapsed,
    sidebarWidth,
    isCreatingFolder,
    newFolderName,
    editingFolderId,
    editingFolderName,
    draggedConversation,
    draggedDocument,
    dragOverFolder,
    searchQuery,
    searchConversations,
    searchDocuments,
    searchFileBrowsers,
    searchApps,
    isSearching,

    toggleFolder,
    setSidebarOpen,
    setSidebarCollapsed,
    setSidebarWidth,
    setIsCreatingFolder,
    setNewFolderName,
    setEditingFolderId,
    setEditingFolderName,
    setDraggedConversation,
    setDraggedDocument,
    setDragOverFolder,
    setDefaultFolderId,
    setDeleteConfirm,
    createFolder,
    createDocument,
    createFileBrowser,
    createApp,
    moveAppToFolder,
    updateFolder,
    moveConversationToFolder,
    moveDocumentToFolder,
    moveFileBrowserToFolder,
    deleteItem,
    hasMoreSidebarItems,
    loadMoreSidebarItems,
    isLoadingMoreSidebarItems,
    location,
    setSearchQuery,
    clearSearch,
    isLoading,
  } = useChatContext();

  const [mounted, setMounted] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [clientSideWidth, setClientSideWidth] = useState<number | null>(null);
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [localSearchInput, setLocalSearchInput] = useState("");
  const [showNewMenu, setShowNewMenu] = useState(false);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMounted(true);
    // Set client-side width after hydration
    setClientSideWidth(sidebarWidth);

    // Fetch user info
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.email) setUser(data);
      })
      .catch(err => console.error("Failed to fetch user:", err));
  }, [sidebarWidth]);

  // Debounce search input
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(localSearchInput);
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [localSearchInput, setSearchQuery]);

  // Handle resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      // Calculate new width based on mouse position
      const newWidth = e.clientX;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, setSidebarWidth]);

  const startNewChat = () => {
    // Hard reload to home page to reset all state
    window.location.href = '/';
  };

  const startNewDoc = async () => {
    const doc = await createDocument();
    if (doc) {
      router.push(`/doc/${doc.id}`);
      setSidebarOpen(false);
    }
  };

  const startNewFileBrowser = async () => {
    const fb = await createFileBrowser();
    if (fb) {
      router.push(`/filebrowser/${fb.id}`);
      setSidebarOpen(false);
    }
  };

  const startNewApp = async () => {
    const app = await createApp();
    if (app) {
      router.push(`/app/${app.id}`);
      setSidebarOpen(false);
    }
  };

  const selectConversation = (id: string) => {
    router.push(`/chat/${id}`);
    setSidebarOpen(false);
  };

  const selectDocument = (id: string) => {
    router.push(`/doc/${id}`);
    setSidebarOpen(false);
  };

  const selectFileBrowser = (id: string) => {
    router.push(`/filebrowser/${id}`);
    setSidebarOpen(false);
  };

  const selectApp = (id: string) => {
    router.push(`/app/${id}`);
    setSidebarOpen(false);
  };

  const navigateToMe = () => {
    router.push('/me');
    setSidebarOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleDeleteFolderClick = (e: React.MouseEvent, folderId: string, name: string) => {
    e.stopPropagation();
    setDeleteConfirm({ id: folderId, title: name, type: 'folder' });
  };

  const toggleDefaultFolder = (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation();
    if (defaultFolderId === folderId) {
      setDefaultFolderId(null);
    } else {
      setDefaultFolderId(folderId);
    }
  };

  const handleDragStart = (e: React.DragEvent, itemId: string, itemType: 'chat' | 'document' | 'filebrowser' | 'app') => {
    if (itemType === 'chat') {
      setDraggedConversation(itemId);
    } else {
      setDraggedDocument(itemId);
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: itemId, type: itemType }));
  };

  const handleDragEnd = () => {
    setDraggedConversation(null);
    setDraggedDocument(null);
    setDragOverFolder(null);
  };

  const handleDragOver = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(folderId);
  };

  const handleDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'chat') {
        moveConversationToFolder(data.id, folderId);
      } else if (data.type === 'document') {
        moveDocumentToFolder(data.id, folderId);
      } else if (data.type === 'filebrowser') {
        moveFileBrowserToFolder(data.id, folderId);
      } else if (data.type === 'app') {
        moveAppToFolder(data.id, folderId);
      }
    } catch {
      // Fallback for old format
      const conversationId = e.dataTransfer.getData('text/plain');
      if (conversationId) {
        moveConversationToFolder(conversationId, folderId);
      }
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, itemId: string, title: string, itemType: 'conversation' | 'document' | 'filebrowser' | 'app') => {
    e.stopPropagation();
    setDeleteConfirm({ id: itemId, title, type: itemType });
  };

  // Long press handler for mobile
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressDelay = 500; // 500ms for long press

  useEffect(() => {
    return () => {
      // Cleanup timer on unmount
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent, itemId: string, title: string, itemType: 'conversation' | 'document' | 'filebrowser' | 'app') => {
    longPressTimerRef.current = setTimeout(() => {
      setDeleteConfirm({ id: itemId, title, type: itemType });
      longPressTimerRef.current = null;
    }, longPressDelay);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const allItems = useMemo(() => {
    const chatItems: SidebarItem[] = conversations
      .filter((c) => c.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        folder_id: c.folder_id,
        active_job_id: c.active_job_id ?? null,
        is_running: Boolean(c.is_running || c.active_job_id || c.is_yielding),
        is_yielding: Boolean(c.is_yielding),
        updated_at: c.updated_at,
        type: 'chat' as const,
      }));
    const docItems: SidebarItem[] = documents
      .filter((d) => d.id)
      .map((d) => ({
        id: d.id,
        title: d.title,
        folder_id: d.folder_id,
        updated_at: d.updated_at,
        type: 'document' as const,
      }));
    const fbItems: SidebarItem[] = fileBrowsers
      .filter((fb) => fb.id)
      .map((fb) => ({
        id: fb.id,
        title: fb.title,
        folder_id: fb.folder_id,
        updated_at: fb.updated_at,
        type: 'filebrowser' as const,
      }));
    const appItems: SidebarItem[] = apps
      .filter((a) => a.id)
      .map((a) => ({
        id: a.id,
        title: a.title,
        folder_id: a.folder_id,
        updated_at: a.updated_at,
        type: 'app' as const,
      }));
    return [...chatItems, ...docItems, ...fbItems, ...appItems].sort(
      (a, b) => {
        const parseDate = (s: string) => new Date(s.includes(' ') && !s.includes('Z') ? s.replace(' ', 'T') + 'Z' : s);
        return parseDate(b.updated_at).getTime() - parseDate(a.updated_at).getTime();
      }
    );
  }, [conversations, documents, fileBrowsers, apps]);

  const groupedItems = useMemo(() => {
    if (!mounted) {
      return {
        "Last 24 Hours": [],
        "Previous 7 Days": [],
        Older: [],
      };
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const groups: { [key: string]: SidebarItem[] } = {
      "Last 24 Hours": [],
      "Previous 7 Days": [],
      Older: [],
    };

    const parseSqliteDate = (s: string) => new Date(s.includes(' ') && !s.includes('Z') ? s.replace(' ', 'T') + 'Z' : s);

    allItems.filter((item) => !item.folder_id).forEach((item) => {
      const date = parseSqliteDate(item.updated_at);
      if (date >= oneDayAgo) {
        groups["Last 24 Hours"].push(item);
      } else if (date >= sevenDaysAgo) {
        groups["Previous 7 Days"].push(item);
      } else {
        groups["Older"].push(item);
      }
    });

    return groups;
  }, [allItems, mounted]);

  const runningConversationIds = useMemo(() => {
    return new Set(
      conversations
        .filter((conversation) => Boolean(conversation.is_running || conversation.active_job_id || conversation.is_yielding))
        .map((conversation) => conversation.id)
    );
  }, [conversations]);

  const activeConversationId = useMemo(() => {
    if (!pathname.startsWith('/chat/')) return null;
    return pathname.split('/chat/')[1]?.split('?')[0] || null;
  }, [pathname]);

  const renderSidebarItemIcon = (
    itemType: 'chat' | 'document' | 'filebrowser' | 'app',
    itemId: string,
    isYielding?: boolean,
    activeJobId?: string | null,
    isRunning?: boolean,
  ) => {
    if (itemType === 'document') {
      return <FileText size={14} />;
    }

    if (itemType === 'filebrowser') {
      return <FolderCode size={14} />;
    }

    if (itemType === 'app') {
      return <AppWindow size={14} />;
    }

    const isPathActiveAndLoading = Boolean(isLoading && activeConversationId && activeConversationId === itemId);
    const hasRunningState = Boolean(isRunning || activeJobId || isYielding || runningConversationIds.has(itemId));
    if (isPathActiveAndLoading || hasRunningState) {
      return <LoaderCircle size={14} className="chat-item-icon-loading" />;
    }

    return <MessageSquare size={14} />;
  };

  return (
    <>
      {/* Sidebar overlay for mobile */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}
        {...(clientSideWidth !== null && {
          style: {
            '--sidebar-width': `${clientSideWidth}px`
          } as React.CSSProperties
        })}
      >
        <div className="sidebar-header">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            gap: sidebarCollapsed ? '0' : '8px',
            width: '100%'
          }}>
            <a href="/" className="logo" onClick={() => { setSidebarOpen(false); }} style={{ cursor: 'pointer', flexShrink: 0, position: 'relative', textDecoration: 'none', color: 'inherit' }}>
              <div className="logo-icon">
                <img src="/okbrain-icon.png" alt="OKBrain" style={{ width: '100%', height: '100%', borderRadius: '8px' }} />
              </div>
              {!sidebarCollapsed && <span style={{ marginRight: '4px' }}>OKBrain</span>}
            </a>

            {!sidebarCollapsed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <button
                  onClick={navigateToMe}
                  title="Profile"
                  className="header-icon-btn"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    padding: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <UserCircle size={18} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
          {!sidebarCollapsed ? (
            <div className="new-buttons-row">
              <div className="new-menu-container">
                <Button variant="brand" className="new-btn" icon={<Plus size={16} />} onClick={() => setShowNewMenu(!showNewMenu)} fullWidth>
                  New
                </Button>
                {showNewMenu && (
                  <>
                    <div className="new-menu-overlay" onClick={() => setShowNewMenu(false)} />
                    <div className="new-menu-dropdown">
                      <button className="new-menu-item new-chat-btn" onClick={() => { setShowNewMenu(false); startNewChat(); }}>
                        <MessageSquarePlus size={16} />
                        <span>Chat</span>
                      </button>
                      <button className="new-menu-item new-doc-btn" onClick={() => { setShowNewMenu(false); startNewDoc(); }}>
                        <FilePlus size={16} />
                        <span>Doc</span>
                      </button>
                      <button className="new-menu-item" onClick={() => { setShowNewMenu(false); startNewFileBrowser(); }}>
                        <FolderCode size={16} />
                        <span>Files</span>
                      </button>
                      <button className="new-menu-item" onClick={() => { setShowNewMenu(false); startNewApp(); }}>
                        <AppWindow size={16} />
                        <span>App</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="new-menu-container collapsed-new-menu">
              <button
                className="new-btn-collapsed"
                title="New"
                onClick={() => setShowNewMenu(!showNewMenu)}
              >
                <Plus size={20} />
              </button>
              {showNewMenu && (
                <>
                  <div className="new-menu-overlay" onClick={() => setShowNewMenu(false)} />
                  <div className="new-menu-dropdown collapsed-dropdown">
                    <button className="new-menu-item new-chat-btn" onClick={() => { setShowNewMenu(false); startNewChat(); }}>
                      <MessageSquarePlus size={16} />
                      <span>Chat</span>
                    </button>
                    <button className="new-menu-item new-doc-btn" onClick={() => { setShowNewMenu(false); startNewDoc(); }}>
                      <FilePlus size={16} />
                      <span>Doc</span>
                    </button>
                    <button className="new-menu-item" onClick={() => { setShowNewMenu(false); startNewFileBrowser(); }}>
                      <FolderCode size={16} />
                      <span>Files</span>
                    </button>
                    <button className="new-menu-item" onClick={() => { setShowNewMenu(false); startNewApp(); }}>
                      <AppWindow size={16} />
                      <span>App</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            className="sidebar-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarCollapsed(!sidebarCollapsed);
            }}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {/* Mobile close button */}
          <button
            className="sidebar-close-mobile"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarOpen(false);
            }}
            title="Close sidebar"
          >
            <X size={24} />
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="chat-history">
            {/* Search Input */}
            <div className="search-input-container">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="Search ..."
                value={localSearchInput}
                onChange={(e) => setLocalSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setLocalSearchInput("");
                    clearSearch();
                  }
                }}
              />
              {localSearchInput && (
                <button
                  className="search-clear"
                  onClick={() => {
                    setLocalSearchInput("");
                    clearSearch();
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* New Folder Button */}
            <div className="new-folder-row">
              {!isCreatingFolder ? (
                <button
                  className="new-folder-btn"
                  onClick={() => setIsCreatingFolder(true)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </button>
              ) : (
                <div className="new-folder-input-container">
                  <input
                    type="text"
                    className="new-folder-input"
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createFolder();
                      if (e.key === 'Escape') {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    autoFocus
                  />
                  <button className="new-folder-submit" onClick={createFolder}><Plus size={16} /></button>
                  <button
                    className="new-folder-cancel"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Search Results */}
            {searchQuery ? (
              <div className="search-results">
                {isSearching ? (
                  <div className="search-loading">Searching...</div>
                ) : searchConversations.length === 0 && searchDocuments.length === 0 && searchFileBrowsers.length === 0 && searchApps.length === 0 ? (
                  <div className="search-empty">No results found</div>
                ) : (
                  <>
                    {searchConversations.map((conv) => (
                      <div
                        key={`conv-${conv.id}`}
                        className={`chat-item ${pathname === `/chat/${conv.id}` ? "active" : ""}`}
                        onClick={() => selectConversation(conv.id)}
                        onMouseEnter={() => setHoveredItemId(conv.id)}
                        onMouseLeave={() => setHoveredItemId(null)}
                      >
                        <span className="chat-item-icon">
                          {renderSidebarItemIcon(
                            'chat',
                            conv.id,
                            Boolean(conv.is_yielding),
                            conv.active_job_id ?? null,
                            Boolean(conv.is_running)
                          )}
                        </span>
                        <span className="chat-item-title" title={conv.title}>{conv.title}</span>
                      </div>
                    ))}
                    {searchDocuments.map((doc) => (
                      <div
                        key={`doc-${doc.id}`}
                        className={`chat-item ${pathname === `/doc/${doc.id}` ? "active" : ""}`}
                        onClick={() => selectDocument(doc.id)}
                        onMouseEnter={() => setHoveredItemId(doc.id)}
                        onMouseLeave={() => setHoveredItemId(null)}
                      >
                        <span className="chat-item-icon">
                          <FileText size={14} />
                        </span>
                        <span className="chat-item-title" title={doc.title}>{doc.title}</span>
                      </div>
                    ))}
                    {searchFileBrowsers.map((fb) => (
                      <div
                        key={`fb-${fb.id}`}
                        className={`chat-item ${pathname === `/filebrowser/${fb.id}` ? "active" : ""}`}
                        onClick={() => selectFileBrowser(fb.id)}
                        onMouseEnter={() => setHoveredItemId(fb.id)}
                        onMouseLeave={() => setHoveredItemId(null)}
                      >
                        <span className="chat-item-icon">
                          <FolderCode size={14} />
                        </span>
                        <span className="chat-item-title" title={fb.title}>{fb.title}</span>
                      </div>
                    ))}
                    {searchApps.map((app) => (
                      <div
                        key={`app-${app.id}`}
                        className={`chat-item ${pathname === `/app/${app.id}` ? "active" : ""}`}
                        onClick={() => selectApp(app.id)}
                        onMouseEnter={() => setHoveredItemId(app.id)}
                        onMouseLeave={() => setHoveredItemId(null)}
                      >
                        <span className="chat-item-icon">
                          <AppWindow size={14} />
                        </span>
                        <span className="chat-item-title" title={app.title}>{app.title}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <>
            {/* Folders */}
            {folders.map((folder) => {
              const folderItems = allItems.filter((item) => item.folder_id === folder.id);
              const isExpanded = expandedFolders.has(folder.id);
              const isDragOver = dragOverFolder === folder.id;

              return (
                <div key={folder.id} className="folder-container">
                  <div
                    className={`folder-header ${isDragOver ? 'drag-over' : ''} ${defaultFolderId === folder.id ? 'is-default' : ''}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggleFolder(folder.id)}
                    onDragOver={(e) => handleDragOver(e, folder.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, folder.id)}
                  >
                    <span className="folder-expand-icon">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    {editingFolderId === folder.id ? (
                      <input
                        type="text"
                        className="folder-name-input"
                        value={editingFolderName}
                        onChange={(e) => setEditingFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') updateFolder(folder.id, editingFolderName);
                          if (e.key === 'Escape') {
                            setEditingFolderId(null);
                            setEditingFolderName("");
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="folder-name"
                        title={folder.name}
                        onDoubleClick={(e) => {
                          if (folder.is_shared === 1) return;
                          e.stopPropagation();
                          setEditingFolderId(folder.id);
                          setEditingFolderName(folder.name);
                        }}
                      >
                        {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />} {folder.name}
                      </span>
                    )}
                    {folder.is_shared !== 1 && (
                      <button
                        className="folder-delete"
                        onClick={(e) => handleDeleteFolderClick(e, folder.id, folder.name)}
                        title="Delete folder"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button
                      className={`folder-pin ${defaultFolderId === folder.id ? 'is-pinned' : ''}`}
                      onClick={(e) => toggleDefaultFolder(e, folder.id)}
                      title={defaultFolderId === folder.id ? "Unset as default folder" : "Set as default folder for new items"}
                    >
                      <Pin size={14} />
                    </button>
                    <span className="folder-count">{folderItems.length}</span>
                  </div>
                  {isExpanded && (
                    <div className="folder-conversations">
                      {folderItems.length === 0 ? (
                        <div className="folder-empty">Drop items here</div>
                      ) : (
                        folderItems.map((item) => (
                          <div
                            key={`${item.type}-${item.id}`}
                            className={`chat-item ${item.type === 'chat' ? (pathname === `/chat/${item.id}` ? "active" : "") : item.type === 'filebrowser' ? (pathname === `/filebrowser/${item.id}` ? "active" : "") : item.type === 'app' ? (pathname === `/app/${item.id}` ? "active" : "") : (pathname === `/doc/${item.id}` ? "active" : "")} ${item.type === 'chat' ? (draggedConversation === item.id ? "dragging" : "") : (draggedDocument === item.id ? "dragging" : "")}`}
                            onClick={() => item.type === 'chat' ? selectConversation(item.id) : item.type === 'filebrowser' ? selectFileBrowser(item.id) : item.type === 'app' ? selectApp(item.id) : selectDocument(item.id)}
                            onTouchStart={(e) => handleTouchStart(e, item.id, item.title, item.type === 'chat' ? 'conversation' : item.type as any)}
                            onTouchEnd={handleTouchEnd}
                            onTouchMove={handleTouchMove}
                            draggable
                            onDragStart={(e) => handleDragStart(e, item.id, item.type)}
                            onDragEnd={handleDragEnd}
                            onMouseEnter={() => setHoveredItemId(item.id)}
                            onMouseLeave={() => setHoveredItemId(null)}
                          >
                            <span className="chat-item-icon">
                              {renderSidebarItemIcon(item.type, item.id, item.is_yielding, item.active_job_id, item.is_running)}
                            </span>
                            <span className="chat-item-title" title={item.title}>{item.title}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Uncategorized items (no folder) */}
            <div
              className={`uncategorized-section ${dragOverFolder === 'uncategorized' ? 'drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, 'uncategorized')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, null)}
            >
              {/* Ungrouped header - always visible as drop target */}
              <div className="ungrouped-header">
                <Library size={16} />
                <span>All Items</span>
              </div>
              {Object.entries(groupedItems).map(
                ([group, items]) =>
                  items.length > 0 && (
                    <div key={group}>
                      <div className="history-section-title">{group}</div>
                      {items.map((item) => (
                        <div
                          key={`${item.type}-${item.id}`}
                          className={`chat-item ${item.type === 'chat' ? (pathname === `/chat/${item.id}` ? "active" : "") : item.type === 'filebrowser' ? (pathname === `/filebrowser/${item.id}` ? "active" : "") : item.type === 'app' ? (pathname === `/app/${item.id}` ? "active" : "") : (pathname === `/doc/${item.id}` ? "active" : "")} ${item.type === 'chat' ? (draggedConversation === item.id ? "dragging" : "") : (draggedDocument === item.id ? "dragging" : "")}`}
                          onClick={() => item.type === 'chat' ? selectConversation(item.id) : item.type === 'filebrowser' ? selectFileBrowser(item.id) : item.type === 'app' ? selectApp(item.id) : selectDocument(item.id)}
                          onTouchStart={(e) => handleTouchStart(e, item.id, item.title, item.type === 'chat' ? 'conversation' : item.type as any)}
                          onTouchEnd={handleTouchEnd}
                          onTouchMove={handleTouchMove}
                          draggable
                          onDragStart={(e) => handleDragStart(e, item.id, item.type)}
                          onDragEnd={handleDragEnd}
                          onMouseEnter={() => setHoveredItemId(item.id)}
                          onMouseLeave={() => setHoveredItemId(null)}
                        >
                          <span className="chat-item-icon">
                            {renderSidebarItemIcon(item.type, item.id, item.is_yielding, item.active_job_id, item.is_running)}
                          </span>
                          <span className="chat-item-title" title={item.title}>{item.title}</span>
                        </div>
                      ))}
                    </div>
                  )
              )}
              {/* Load More Button */}
              {hasMoreSidebarItems && (
                <div style={{ padding: '8px 12px' }}>
                  <Button
                    fullWidth
                    variant="secondary"
                    onClick={loadMoreSidebarItems}
                    disabled={isLoadingMoreSidebarItems}
                    style={{ justifyContent: 'center', opacity: 0.7 }}
                  >
                    {isLoadingMoreSidebarItems ? 'Loading...' : 'Load More'}
                  </Button>
                </div>
              )}
            </div>
            </>
            )}
          </div>
        )}

        {/* Sidebar Footer with Account Info & Logout */}
        {!sidebarCollapsed && user && (
          <div className="sidebar-footer">
            <div className="user-account" title={user.email}>
              <div className="user-avatar">{user.email[0].toUpperCase()}</div>
              <span className="user-email">{user.email}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout} title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        )}
        {sidebarCollapsed && user && (
          <div className="sidebar-footer collapsed">
            <button className="logout-btn" onClick={handleLogout} title={`Logout (${user.email})`}>
              <LogOut size={18} />
            </button>
          </div>
        )}

        {/* Resize handle - only show on desktop when not collapsed */}
        {!sidebarCollapsed && (
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleMouseDown}
            title="Drag to resize"
          />
        )}
      </aside >
    </>
  );
}
