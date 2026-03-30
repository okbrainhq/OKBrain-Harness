"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { getCookie, setCookie } from "../utils/cookies";
import type { ModelsConfig, ModelInfo } from "@/lib/ai/client-types";
import { useLocation, UseLocationResult } from "@/hooks/useLocation";

// Image attachment type (for temporary display, not persisted)
interface ImageAttachment {
  mimeType: string;
  base64: string;
  previewUrl: string; // Object URL for display
}

// File attachment type (uploaded to FILE API)
export interface FileAttachment {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  uploadedAt: string;
  expirationTime: string;
  previewUrl?: string; // Object URL for local preview
}

interface Folder {
  id: string;
  name: string;
  is_shared?: number;
  created_at: string;
  updated_at: string;
}

interface Conversation {
  id: string;
  title: string;
  folder_id?: string | null;
  active_job_id?: string | null;
  is_running?: number | boolean;
  is_yielding?: number | boolean;
  grounding_enabled?: number;
  response_mode?: string;
  ai_provider?: string;
  document_ids?: string[];
  created_at: string;
  updated_at: string;
}

interface Document {
  id: string;
  title: string;
  content: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface FileBrowser {
  id: string;
  title: string;
  current_path: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface AppItem {
  id: string;
  title: string;
  description?: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

type ResponseMode = 'quick' | 'detailed';

interface ChatContextType {
  // Model configuration from server
  modelsConfig: ModelsConfig;
  getCurrentModel: () => ModelInfo | undefined;

  conversations: Conversation[];
  documents: Document[];
  fileBrowsers: FileBrowser[];
  apps: AppItem[];
  folders: Folder[];
  expandedFolders: Set<string>;
  defaultFolderId: string | null;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  sidebarPageSize: number;
  sidebarOffset: number;
  hasMoreSidebarItems: boolean;
  isLoadingMoreSidebarItems: boolean;
  loadMoreSidebarItems: () => Promise<void>;
  isCreatingFolder: boolean;
  newFolderName: string;
  editingFolderId: string | null;
  editingFolderName: string;
  draggedConversation: string | null;
  draggedDocument: string | null;
  dragOverFolder: string | null;
  deleteConfirm: { id: string; title: string; type: 'conversation' | 'folder' | 'document' | 'filebrowser' | 'app' } | null;
  renameConfirm: { id: string; title: string; type: 'conversation' | 'document' | 'filebrowser' | 'app' } | null;
  setRenameConfirm: (confirm: { id: string; title: string; type: 'conversation' | 'document' | 'filebrowser' | 'app' } | null) => void;
  renameItem: (newTitle: string) => Promise<void>;

  // Search state
  searchQuery: string;
  searchConversations: Conversation[];
  searchDocuments: Document[];
  searchFileBrowsers: FileBrowser[];
  searchApps: AppItem[];
  isSearching: boolean;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;

  // Input state (shared across pages)
  input: string;
  setInput: (input: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  isCancelling: boolean;
  setIsCancelling: (cancelling: boolean) => void;
  thinking: boolean;
  setThinking: (thinking: boolean) => void;
  responseMode: ResponseMode;
  setResponseMode: (mode: ResponseMode) => void;
  aiProvider: string;
  setAiProvider: (provider: string) => void;
  saveAiProviderPreference: (provider: string) => void;
  sendMessageRef: React.MutableRefObject<((options?: { message?: string; provider?: string; skipProviderUpdate?: boolean; endpoint?: string; thinking?: boolean }) => Promise<void>) | null>;
  stopStreamingRef: React.MutableRefObject<(() => void) | null>;
  focusInputRef: React.MutableRefObject<(() => void) | null>;

  // Image attachment (temporary, not persisted)
  imageAttachment: ImageAttachment | null;
  setImageAttachment: (image: ImageAttachment | null) => void;
  clearImageAttachment: () => void;

  // File attachments (uploaded to FILE API, persisted)
  fileAttachments: FileAttachment[];
  setFileAttachments: (files: FileAttachment[]) => void;
  addFileAttachment: (file: FileAttachment) => void;
  removeFileAttachment: (uri: string) => void;
  clearFileAttachments: () => void;

  // Actions
  loadConversations: () => Promise<void>;
  loadDocuments: () => Promise<void>;
  loadFolders: () => Promise<void>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  setDocuments: React.Dispatch<React.SetStateAction<Document[]>>;
  setFileBrowsers: React.Dispatch<React.SetStateAction<FileBrowser[]>>;
  setApps: React.Dispatch<React.SetStateAction<AppItem[]>>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  toggleFolder: (folderId: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setIsCreatingFolder: (creating: boolean) => void;
  setNewFolderName: (name: string) => void;
  setEditingFolderId: (id: string | null) => void;
  setEditingFolderName: (name: string) => void;
  setDraggedConversation: (id: string | null) => void;
  setDraggedDocument: (id: string | null) => void;
  setDragOverFolder: (id: string | null) => void;
  setDefaultFolderId: (id: string | null) => void;
  setDeleteConfirm: (confirm: { id: string; title: string; type: 'conversation' | 'folder' | 'document' | 'filebrowser' | 'app' } | null) => void;
  createFolder: () => Promise<void>;
  createDocument: () => Promise<Document | null>;
  createFileBrowser: () => Promise<FileBrowser | null>;
  createApp: () => Promise<AppItem | null>;
  moveAppToFolder: (appId: string, folderId: string | null) => Promise<void>;
  updateFolder: (folderId: string, name: string) => Promise<void>;
  moveConversationToFolder: (conversationId: string, folderId: string | null) => Promise<void>;
  moveDocumentToFolder: (documentId: string, folderId: string | null) => Promise<void>;
  moveFileBrowserToFolder: (fileBrowserId: string, folderId: string | null) => Promise<void>;
  deleteItem: () => Promise<void>;

  // Read-only mode for old conversations
  isConversationReadOnly: boolean;
  setIsConversationReadOnly: (readOnly: boolean) => void;

  // Yielded tool jobs (background tasks tab)
  yieldedToolJobs: Array<{ toolJobId: string; toolName: string; command?: string; callId?: string; state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout'; sinceSeq: number; conversationId?: string }>;
  setYieldedToolJobs: React.Dispatch<React.SetStateAction<Array<{ toolJobId: string; toolName: string; command?: string; callId?: string; state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout'; sinceSeq: number; conversationId?: string }>>>;

  // Location
  location: UseLocationResult;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({
  children,
  modelsConfig,
  initialSidebarCollapsed = false,
  initialAiProvider,
  initialResponseMode = 'detailed',
  initialThinking = true,
}: {
  children: ReactNode;
  modelsConfig: ModelsConfig;
  initialSidebarCollapsed?: boolean;
  initialAiProvider?: string;
  initialResponseMode?: 'quick' | 'detailed';
  initialThinking?: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [fileBrowsers, setFileBrowsers] = useState<FileBrowser[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [defaultFolderId, setDefaultFolderIdState] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(initialSidebarCollapsed);

  // Pagination state
  const SIDEBAR_PAGE_SIZE = 50;
  const [sidebarOffset, setSidebarOffset] = useState(0);
  const [hasMoreSidebarItems, setHasMoreSidebarItems] = useState(true);
  const [isLoadingMoreSidebarItems, setIsLoadingMoreSidebarItems] = useState(false);

  // Initialize sidebar width from cookie synchronously to avoid hydration mismatch
  const [sidebarWidth, setSidebarWidthState] = useState(() => {
    if (typeof window === 'undefined') return 280; // SSR default
    const savedWidth = getCookie('sidebarWidth');
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (!isNaN(width) && width >= 200 && width <= 600) {
        return width;
      }
    }
    return 280;
  });

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [draggedConversation, setDraggedConversation] = useState<string | null>(null);
  const [draggedDocument, setDraggedDocument] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string; type: 'conversation' | 'folder' | 'document' | 'filebrowser' | 'app' } | null>(null);
  const [renameConfirm, setRenameConfirm] = useState<{ id: string; title: string; type: 'conversation' | 'document' | 'filebrowser' | 'app' } | null>(null);

  // Input state (shared across pages)
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [thinking, setThinking] = useState(initialThinking);
  const [responseMode, setResponseMode] = useState<ResponseMode>(initialResponseMode);
  const [aiProvider, setAiProviderState] = useState<string>(initialAiProvider ?? modelsConfig.defaultModelId);
  const sendMessageRef = useRef<((options?: { message?: string; provider?: string; skipProviderUpdate?: boolean; endpoint?: string; thinking?: boolean }) => Promise<void>) | null>(null);
  const stopStreamingRef = useRef<(() => void) | null>(null);
  const focusInputRef = useRef<(() => void) | null>(null);

  // Read-only mode for old conversations
  const [isConversationReadOnly, setIsConversationReadOnly] = useState(false);
  const [yieldedToolJobs, setYieldedToolJobs] = useState<Array<{ toolJobId: string; toolName: string; command?: string; callId?: string; state: 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout'; sinceSeq: number; conversationId?: string }>>([]);

  // Image attachment (temporary, not persisted)
  const [imageAttachment, setImageAttachment] = useState<ImageAttachment | null>(null);

  // File attachments (uploaded to FILE API, persisted)
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);

  // Search state
  const [searchQuery, setSearchQueryState] = useState("");
  const [searchConversations, setSearchConversations] = useState<Conversation[]>([]);
  const [searchDocuments, setSearchDocuments] = useState<Document[]>([]);
  const [searchFileBrowsers, setSearchFileBrowsers] = useState<FileBrowser[]>([]);
  const [searchApps, setSearchApps] = useState<AppItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const sortFolders = useCallback((items: Folder[]) => {
    return [...items].sort((a, b) => {
      const sharedDiff = (b.is_shared ?? 0) - (a.is_shared ?? 0);
      if (sharedDiff !== 0) return sharedDiff;
      return a.name.localeCompare(b.name);
    });
  }, []);

  // Location
  const location = useLocation();

  // Load initial data
  useEffect(() => {
    // loadConversations(); // Disabled in favor of loadMoreSidebarItems
    // loadDocuments();     // Disabled in favor of loadMoreSidebarItems
    loadFolders();


    // Load saved preferences from localStorage
    const savedExpandedFolders = localStorage.getItem('expandedFolders');
    if (savedExpandedFolders) {
      try {
        setExpandedFolders(new Set(JSON.parse(savedExpandedFolders)));
      } catch (e) {
        // Ignore parse errors
      }
    }
    const savedDefaultFolder = localStorage.getItem('defaultFolderId');
    if (savedDefaultFolder) {
      setDefaultFolderIdState(savedDefaultFolder);
    }
    // Note: responseMode, aiProvider, and thinking are now loaded from server via SSR
    // and set by ChatView using the initial* props
  }, []);

  // Track if preferences have been initialized to avoid saving default values on mount
  const prefsInitializedRef = useRef(false);

  // Save preferences to server when they change
  useEffect(() => {
    if (!prefsInitializedRef.current) return;
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'chat:responseMode', value: responseMode }),
    }).catch(() => {/* ignore errors */ });
  }, [responseMode]);

  useEffect(() => {
    if (!prefsInitializedRef.current) return;
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'chat:thinking', value: String(thinking) }),
    }).catch(() => {/* ignore errors */ });
  }, [thinking]);

  const saveAiProviderPreference = useCallback((provider: string) => {
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'chat:aiProvider', value: provider }),
    }).catch(() => {/* ignore errors */ });
  }, []);

  // Mark preferences as initialized after first render
  useEffect(() => {
    prefsInitializedRef.current = true;
  }, []);

  const loadConversations = useCallback(async () => {
    // Legacy: keeping this for now but it should ideally be replaced by unified loading
    // We will let loadMoreSidebarItems handle the main list population
  }, []);

  const loadDocuments = useCallback(async () => {
    // Legacy: keeping this for now but it should ideally be replaced by unified loading
    // We will let loadMoreSidebarItems handle the main list population
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/folders");
      const data = await res.json();
      setFolders(sortFolders(data));

      // Load items for folders (populate conversation/documents state with folder items)
      // This ensures folder items are available even if they are not in the top 50 recent
      // Note: This is an optimization; ideally we'd have a specific API for "all folder items"
      // avoiding fetching everything. For now, we fetch uncategorized via pagination,
      // and we might need to fetch folder contents separately.
      // However, to keep it simple and compliant with "For folders, keep it like that",
      // we need to make sure folder items are loaded.

      // Strategy:
      // 1. Fetch initial paginated list (uncategorized).
      // 2. Fetch all items (legacy) ?? No, that defeats pagination.
      // 3. We typically only need to load items for expanded folders, or all folders.
      // Let's implement a separate fetch for folder items.

      for (const folder of data) {
        const folderItemsRes = await fetch(`/api/sidebar/items?type=folder&folderId=${folder.id}`);
        if (folderItemsRes.ok) {
          const items = await folderItemsRes.json();
          processSidebarItems(items);
        }
      }

    } catch (error) {
      console.error("Failed to load folders:", error);
    }
  }, [sortFolders]);

  const processSidebarItems = useCallback((items: any[]) => {
    const newConvs: any[] = [];
    const newDocs: any[] = [];
    const newFBs: any[] = [];
    const newApps: any[] = [];

    items.forEach(item => {
      if (item.type === 'chat') {
        newConvs.push(item);
      } else if (item.type === 'filebrowser') {
        newFBs.push(item);
      } else if (item.type === 'app') {
        newApps.push(item);
      } else {
        newDocs.push(item);
      }
    });

    setConversations(prev => {
      const incomingById = new Map(newConvs.map(c => [c.id, c]));
      const merged = prev.map(c => incomingById.has(c.id) ? { ...c, ...incomingById.get(c.id) } : c);
      const existingIds = new Set(prev.map(c => c.id));
      const additions = newConvs.filter(c => !existingIds.has(c.id));
      return [...merged, ...additions];
    });

    setDocuments(prev => {
      const incomingById = new Map(newDocs.map(d => [d.id, d]));
      const merged = prev.map(d => incomingById.has(d.id) ? { ...d, ...incomingById.get(d.id) } : d);
      const existingIds = new Set(prev.map(d => d.id));
      const additions = newDocs.filter(d => !existingIds.has(d.id));
      return [...merged, ...additions];
    });

    setFileBrowsers(prev => {
      const incomingById = new Map(newFBs.map(fb => [fb.id, fb]));
      const merged = prev.map(fb => incomingById.has(fb.id) ? { ...fb, ...incomingById.get(fb.id) } : fb);
      const existingIds = new Set(prev.map(fb => fb.id));
      const additions = newFBs.filter(fb => !existingIds.has(fb.id));
      return [...merged, ...additions];
    });

    setApps(prev => {
      const incomingById = new Map(newApps.map(a => [a.id, a]));
      const merged = prev.map(a => incomingById.has(a.id) ? { ...a, ...incomingById.get(a.id) } : a);
      const existingIds = new Set(prev.map(a => a.id));
      const additions = newApps.filter(a => !existingIds.has(a.id));
      return [...merged, ...additions];
    });
  }, []);

  const loadMoreSidebarItems = useCallback(async () => {
    if (!hasMoreSidebarItems || isLoadingMoreSidebarItems) return;

    setIsLoadingMoreSidebarItems(true);
    try {
      const res = await fetch(`/api/sidebar/items?type=uncategorized&limit=${SIDEBAR_PAGE_SIZE}&offset=${sidebarOffset}`);
      if (!res.ok) throw new Error("Failed to fetch sidebar items");

      const items = await res.json();
      if (items.length < SIDEBAR_PAGE_SIZE) {
        setHasMoreSidebarItems(false);
      }

      if (items.length > 0) {
        processSidebarItems(items);
        setSidebarOffset(prev => prev + SIDEBAR_PAGE_SIZE);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMoreSidebarItems(false);
    }
  }, [hasMoreSidebarItems, sidebarOffset, processSidebarItems, isLoadingMoreSidebarItems]);

  // Initial load
  useEffect(() => {
    loadMoreSidebarItems();
  }, []); // Run once on mount (managed by hasMore check mostly, but we want explicit start)


  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      localStorage.setItem('expandedFolders', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const setDefaultFolderId = useCallback((id: string | null) => {
    setDefaultFolderIdState(id);
    if (id) {
      localStorage.setItem('defaultFolderId', id);
    } else {
      localStorage.removeItem('defaultFolderId');
    }
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    setCookie('sidebarCollapsed', String(collapsed));
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    // Constrain width between 200px and 600px
    const constrainedWidth = Math.min(Math.max(width, 200), 600);
    setSidebarWidthState(constrainedWidth);
    setCookie('sidebarWidth', String(constrainedWidth));
  }, []);

  const createFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      if (!res.ok) {
        console.error("Failed to create folder:", await res.text());
        return;
      }
      const folder = await res.json();
      setFolders((prev) => sortFolders([...prev.filter((f) => f.id !== folder.id), folder]));
      setNewFolderName("");
      setIsCreatingFolder(false);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(folder.id);
        localStorage.setItem('expandedFolders', JSON.stringify([...next]));
        return next;
      });
    } catch (error) {
      console.error("Failed to create folder:", error);
    }
  }, [newFolderName, sortFolders]);

  const updateFolder = useCallback(async (folderId: string, name: string) => {
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        console.error("Failed to update folder:", await res.text());
        return;
      }
      setFolders((prev) =>
        sortFolders(prev.map((f) => (f.id === folderId ? { ...f, name } : f)))
      );
      setEditingFolderId(null);
      setEditingFolderName("");
    } catch (error) {
      console.error("Failed to update folder:", error);
    }
  }, [sortFolders]);

  const moveConversationToFolder = useCallback(async (conversationId: string, folderId: string | null) => {
    try {
      await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, folder_id: folderId } : c))
      );
    } catch (error) {
      console.error("Failed to move conversation:", error);
    }
    setDraggedConversation(null);
    setDragOverFolder(null);
  }, []);

  const moveDocumentToFolder = useCallback(async (documentId: string, folderId: string | null) => {
    try {
      await fetch(`/api/docs/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      setDocuments((prev) =>
        prev.map((d) => (d.id === documentId ? { ...d, folder_id: folderId } : d))
      );
    } catch (error) {
      console.error("Failed to move document:", error);
    }
    setDraggedDocument(null);
    setDragOverFolder(null);
  }, []);

  const createDocument = useCallback(async (): Promise<Document | null> => {
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled Document",
          folder_id: defaultFolderId
        }),
      });
      if (!res.ok) {
        console.error("Failed to create document:", res.status, res.statusText);
        return null;
      }
      const doc = await res.json();
      if (!doc || !doc.id) {
        console.error("Document created without ID:", doc);
        return null;
      }
      setDocuments((prev) => [doc, ...prev]);
      return doc;
    } catch (error) {
      console.error("Failed to create document:", error);
      return null;
    }
  }, [defaultFolderId]);

  const createFileBrowser = useCallback(async (): Promise<FileBrowser | null> => {
    try {
      const res = await fetch("/api/filebrowser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "File Browser",
          folder_id: defaultFolderId
        }),
      });
      if (!res.ok) {
        console.error("Failed to create file browser:", res.status, res.statusText);
        return null;
      }
      const fb = await res.json();
      if (!fb || !fb.id) {
        console.error("File browser created without ID:", fb);
        return null;
      }
      setFileBrowsers((prev) => [fb, ...prev]);
      return fb;
    } catch (error) {
      console.error("Failed to create file browser:", error);
      return null;
    }
  }, [defaultFolderId]);

  const createApp = useCallback(async (): Promise<AppItem | null> => {
    try {
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled App",
          folder_id: defaultFolderId
        }),
      });
      if (res.status === 409) {
        alert('An app named "Untitled App" already exists. Please rename it first.');
        return null;
      }
      if (!res.ok) {
        console.error("Failed to create app:", res.status, res.statusText);
        return null;
      }
      const app = await res.json();
      if (!app || !app.id) {
        console.error("App created without ID:", app);
        return null;
      }
      setApps((prev) => [app, ...prev]);
      return app;
    } catch (error) {
      console.error("Failed to create app:", error);
      return null;
    }
  }, [defaultFolderId]);

  const moveAppToFolder = useCallback(async (appId: string, folderId: string | null) => {
    try {
      await fetch(`/api/apps/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      setApps((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, folder_id: folderId } : a))
      );
    } catch (error) {
      console.error("Failed to move app:", error);
    }
    setDraggedDocument(null);
    setDragOverFolder(null);
  }, []);

  const moveFileBrowserToFolder = useCallback(async (fileBrowserId: string, folderId: string | null) => {
    try {
      await fetch(`/api/filebrowser/${fileBrowserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      setFileBrowsers((prev) =>
        prev.map((fb) => (fb.id === fileBrowserId ? { ...fb, folder_id: folderId } : fb))
      );
    } catch (error) {
      console.error("Failed to move file browser:", error);
    }
    setDraggedDocument(null);
    setDragOverFolder(null);
  }, []);

  const clearImageAttachment = useCallback(() => {
    if (imageAttachment?.previewUrl) {
      URL.revokeObjectURL(imageAttachment.previewUrl);
    }
    setImageAttachment(null);
  }, [imageAttachment]);

  // File attachment functions
  const addFileAttachment = useCallback((file: FileAttachment) => {
    setFileAttachments((prev) => [...prev, file]);
  }, []);

  const removeFileAttachment = useCallback((uri: string) => {
    setFileAttachments((prev) => {
      const removed = prev.find((f) => f.uri === uri);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((f) => f.uri !== uri);
    });
  }, []);

  const clearFileAttachments = useCallback(() => {
    fileAttachments.forEach((file) => {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setFileAttachments([]);
  }, [fileAttachments]);

  const getCurrentModel = useCallback(() => {
    return modelsConfig.models.find(m => m.id === aiProvider);
  }, [modelsConfig.models, aiProvider]);

  const setAiProvider = useCallback((provider: string) => {
    setAiProviderState(provider);
    // Clear attachments if the new model doesn't support file upload
    const model = modelsConfig.models.find(m => m.id === provider);
    if (!model?.capabilities.fileUpload) {
      clearFileAttachments();
      clearImageAttachment();
    }
  }, [modelsConfig.models, clearFileAttachments, clearImageAttachment]);

  const deleteItem = useCallback(async () => {
    if (!deleteConfirm) return;

    try {
      if (deleteConfirm.type === 'folder') {
        await fetch(`/api/folders/${deleteConfirm.id}`, { method: "DELETE" });
        setFolders((prev) => prev.filter((f) => f.id !== deleteConfirm.id));
        setConversations((prev) =>
          prev.map((c) => (c.folder_id === deleteConfirm.id ? { ...c, folder_id: null } : c))
        );
        setDocuments((prev) =>
          prev.map((d) => (d.folder_id === deleteConfirm.id ? { ...d, folder_id: null } : d))
        );
        setFileBrowsers((prev) =>
          prev.map((fb) => (fb.folder_id === deleteConfirm.id ? { ...fb, folder_id: null } : fb))
        );
        setApps((prev) =>
          prev.map((a) => (a.folder_id === deleteConfirm.id ? { ...a, folder_id: null } : a))
        );
        if (defaultFolderId === deleteConfirm.id) {
          setDefaultFolderId(null);
        }
      } else if (deleteConfirm.type === 'document') {
        await fetch(`/api/docs/${deleteConfirm.id}`, { method: "DELETE" });
        setDocuments((prev) => prev.filter((d) => d.id !== deleteConfirm.id));
      } else if (deleteConfirm.type === 'filebrowser') {
        await fetch(`/api/filebrowser/${deleteConfirm.id}`, { method: "DELETE" });
        setFileBrowsers((prev) => prev.filter((fb) => fb.id !== deleteConfirm.id));
      } else if (deleteConfirm.type === 'app') {
        await fetch(`/api/apps/${deleteConfirm.id}`, { method: "DELETE" });
        setApps((prev) => prev.filter((a) => a.id !== deleteConfirm.id));
      } else {
        await fetch(`/api/conversations/${deleteConfirm.id}`, { method: "DELETE" });
        setConversations((prev) => prev.filter((c) => c.id !== deleteConfirm.id));
      }
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete:", error);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, defaultFolderId, setDefaultFolderId]);

  const renameItem = useCallback(async (newTitle: string) => {
    if (!renameConfirm) return;
    try {
      if (renameConfirm.type === 'document') {
        await fetch(`/api/docs/${renameConfirm.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        setDocuments((prev) =>
          prev.map((d) => d.id === renameConfirm.id ? { ...d, title: newTitle } : d)
        );
      } else if (renameConfirm.type === 'filebrowser') {
        await fetch(`/api/filebrowser/${renameConfirm.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        setFileBrowsers((prev) =>
          prev.map((fb) => fb.id === renameConfirm.id ? { ...fb, title: newTitle } : fb)
        );
      } else if (renameConfirm.type === 'app') {
        const res = await fetch(`/api/apps/${renameConfirm.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        if (res.status === 409) {
          alert('An app with this name already exists');
          return;
        }
        setApps((prev) =>
          prev.map((a) => a.id === renameConfirm.id ? { ...a, title: newTitle } : a)
        );
      } else {
        await fetch(`/api/conversations/${renameConfirm.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        setConversations((prev) =>
          prev.map((c) => c.id === renameConfirm.id ? { ...c, title: newTitle } : c)
        );
      }
      setRenameConfirm(null);
    } catch (error) {
      console.error("Failed to rename:", error);
      setRenameConfirm(null);
    }
  }, [renameConfirm]);

  const setSearchQuery = useCallback(async (query: string) => {
    setSearchQueryState(query);
    if (!query || query.length < 2) {
      setSearchConversations([]);
      setSearchDocuments([]);
      setSearchFileBrowsers([]);
      setSearchApps([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchConversations(data.conversations || []);
      setSearchDocuments(data.documents || []);
      setSearchFileBrowsers(data.fileBrowsers || []);
      setSearchApps(data.apps || []);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchConversations([]);
      setSearchDocuments([]);
      setSearchFileBrowsers([]);
      setSearchApps([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQueryState("");
    setSearchConversations([]);
    setSearchDocuments([]);
    setSearchFileBrowsers([]);
    setSearchApps([]);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        modelsConfig,
        getCurrentModel,
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
        sidebarPageSize: SIDEBAR_PAGE_SIZE,
        sidebarOffset,
        hasMoreSidebarItems,
        isLoadingMoreSidebarItems,
        loadMoreSidebarItems,
        isCreatingFolder,

        newFolderName,
        editingFolderId,
        editingFolderName,
        draggedConversation,
        draggedDocument,
        dragOverFolder,
        deleteConfirm,
        renameConfirm,
        setRenameConfirm,
        renameItem,

        // Search state
        searchQuery,
        searchConversations,
        searchDocuments,
        searchFileBrowsers,
        searchApps,
        isSearching,
        setSearchQuery,
        clearSearch,

        // Input state
        input,
        setInput,
        isLoading,
        setIsLoading,
        isCancelling,
        setIsCancelling,
        thinking,
        setThinking,
        responseMode,
        setResponseMode,
        aiProvider,
        setAiProvider,
        saveAiProviderPreference,
        sendMessageRef,
        stopStreamingRef,
        focusInputRef,

        // Image attachment
        imageAttachment,
        setImageAttachment,
        clearImageAttachment,

        // File attachments
        fileAttachments,
        setFileAttachments,
        addFileAttachment,
        removeFileAttachment,
        clearFileAttachments,

        loadConversations,
        loadDocuments,
        loadFolders,
        setConversations,
        setDocuments,
        setFileBrowsers,
        setApps,
        setFolders,
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
        isConversationReadOnly,
        setIsConversationReadOnly,
        yieldedToolJobs,
        setYieldedToolJobs,
        location,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}
