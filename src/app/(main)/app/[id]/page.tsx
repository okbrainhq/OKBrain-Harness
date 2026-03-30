"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useChatContext } from "../../../context/ChatContext";
import {
  Sparkles, Folder, Trash2, Eye, EyeOff, Plus, Key, FileText,
  MessageSquare, Clock, ArrowRight, MoreVertical, FolderOpen, Save, Code
} from "lucide-react";
import MoveToFolderModal from "../../../components/MoveToFolderModal";
import { Modal } from "../../../components/primitive/Modal";
import FileBrowserContent from "../../../components/FileBrowserContent";
import { Button } from "../../../components/primitive/Button";
import TabBar from "../../../components/primitive/TabBar";
import "../../../components/DocumentEditor.module.css";
import "../../../components/FileBrowser.module.css";
import "../../me/me.css";

interface AppData {
  id: string;
  title: string;
  description: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface SecretEntry {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

type Tab = 'chats' | 'readme' | 'devmd' | 'files' | 'secrets';

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function AppPage() {
  const params = useParams();
  const router = useRouter();
  const appId = params.id as string;
  const { setApps, folders, moveAppToFolder } = useChatContext();

  const [app, setApp] = useState<AppData | null>(null);
  const [title, setTitle] = useState("");
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('chats');
  const [showMenu, setShowMenu] = useState(false);
  const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // README state
  const [readmeContent, setReadmeContent] = useState("");
  const [originalReadme, setOriginalReadme] = useState("");
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [readmeSaving, setReadmeSaving] = useState(false);
  const [readmeSaveStatus, setReadmeSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | null>(null);
  const [readmeLoaded, setReadmeLoaded] = useState(false);

  // DEV.md state
  const [devmdContent, setDevmdContent] = useState("");
  const [originalDevmd, setOriginalDevmd] = useState("");
  const [devmdLoading, setDevmdLoading] = useState(false);
  const [devmdSaving, setDevmdSaving] = useState(false);
  const [devmdSaveStatus, setDevmdSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | null>(null);
  const [devmdLoaded, setDevmdLoaded] = useState(false);

  // Secrets state
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [editingSecretKey, setEditingSecretKey] = useState<string | null>(null);
  const [editingSecretValue, setEditingSecretValue] = useState("");

  // Chats state
  const [pastConversations, setPastConversations] = useState<any[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [chatsLoaded, setChatsLoaded] = useState(false);

  const titleSaveRef = useRef<NodeJS.Timeout | null>(null);
  const appSandboxPath = `apps/${appId}`;

  useEffect(() => {
    if (appId) {
      setIsPageLoading(true);
      setShowLoadingIndicator(false);
      const loadingTimer = setTimeout(() => setShowLoadingIndicator(true), 1000);
      loadApp().finally(() => {
        clearTimeout(loadingTimer);
        setIsPageLoading(false);
        setShowLoadingIndicator(false);
      });
    }
  }, [appId]);

  useEffect(() => {
    if (appId) {
      localStorage.setItem('lastOpenedItem', JSON.stringify({ type: 'app', id: appId }));
    }
  }, [appId]);

  useEffect(() => {
    if (!isPageLoading && app) {
      if (activeTab === 'secrets') loadSecrets();
      if (activeTab === 'chats' && !chatsLoaded) loadPastConversations();
      if (activeTab === 'readme' && !readmeLoaded) loadReadme();
      if (activeTab === 'devmd' && !devmdLoaded) loadDevmd();
    }
  }, [activeTab, isPageLoading, app]);

  const loadApp = async () => {
    try {
      const res = await fetch(`/api/apps/${appId}`);
      if (res.status === 404) { router.push('/'); return; }
      const data = await res.json();
      setApp(data);
      setTitle(data.title);
    } catch (error) {
      console.error("Failed to load app:", error);
      router.push('/');
    }
  };

  // Title auto-save
  useEffect(() => {
    if (!app || title === app.title) return;
    if (titleSaveRef.current) clearTimeout(titleSaveRef.current);
    titleSaveRef.current = setTimeout(() => saveTitle(title), 1000);
    return () => { if (titleSaveRef.current) clearTimeout(titleSaveRef.current); };
  }, [title, app]);

  const saveTitle = useCallback(async (newTitle: string) => {
    if (!app || newTitle === app.title) return;
    try {
      const res = await fetch(`/api/apps/${appId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.status === 409) {
        setTitle(app.title);
        return;
      }
      setApp(prev => prev ? { ...prev, title: newTitle } : prev);
      setApps(prev => prev.map(a => a.id === appId ? { ...a, title: newTitle } : a));
    } catch (error) { console.error("Failed to save title:", error); }
  }, [app, appId, setApps]);

  // README
  const loadReadme = async () => {
    setReadmeLoading(true);
    try {
      // Ensure app dir exists
      await fetch('/api/filebrowser/fs/mkdir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: appSandboxPath }),
      });
      const res = await fetch(`/api/filebrowser/fs/read?path=${encodeURIComponent(`${appSandboxPath}/README.md`)}`);
      if (res.ok) {
        const data = await res.json();
        setReadmeContent(data.content);
        setOriginalReadme(data.content);
        setReadmeSaveStatus('saved');
      } else {
        // README doesn't exist - start with template
        setReadmeContent(`# ${app?.title || 'App'}\n\nDescribe your app here.\n\n## Usage\n\n\`\`\`bash\n# How to run this app\n\`\`\`\n`);
        setOriginalReadme('');
        setReadmeSaveStatus('unsaved');
      }
      setReadmeLoaded(true);
    } catch (error) {
      console.error("Failed to load README:", error);
    } finally {
      setReadmeLoading(false);
    }
  };

  const saveReadme = async () => {
    setReadmeSaving(true);
    setReadmeSaveStatus('saving');
    try {
      await fetch('/api/filebrowser/fs/mkdir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: appSandboxPath }),
      });
      const res = await fetch('/api/filebrowser/fs/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${appSandboxPath}/README.md`, content: readmeContent }),
      });
      if (res.ok) {
        setOriginalReadme(readmeContent);
        setReadmeSaveStatus('saved');
      } else {
        setReadmeSaveStatus('unsaved');
      }
    } catch { setReadmeSaveStatus('unsaved'); }
    finally { setReadmeSaving(false); }
  };

  const handleReadmeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveReadme(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      setReadmeContent(readmeContent.substring(0, start) + '  ' + readmeContent.substring(end));
      setReadmeSaveStatus('unsaved');
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2; }, 0);
    }
  };

  // DEV.md
  const loadDevmd = async () => {
    setDevmdLoading(true);
    try {
      await fetch('/api/filebrowser/fs/mkdir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: appSandboxPath }),
      });
      const res = await fetch(`/api/filebrowser/fs/read?path=${encodeURIComponent(`${appSandboxPath}/DEV.md`)}`);
      if (res.ok) {
        const data = await res.json();
        setDevmdContent(data.content);
        setOriginalDevmd(data.content);
        setDevmdSaveStatus('saved');
      } else {
        setDevmdContent(`# Development Notes\n\nAdd development notes, setup instructions, and technical details here.\n`);
        setOriginalDevmd('');
        setDevmdSaveStatus('unsaved');
      }
      setDevmdLoaded(true);
    } catch (error) {
      console.error("Failed to load DEV.md:", error);
    } finally {
      setDevmdLoading(false);
    }
  };

  const saveDevmd = async () => {
    setDevmdSaving(true);
    setDevmdSaveStatus('saving');
    try {
      await fetch('/api/filebrowser/fs/mkdir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: appSandboxPath }),
      });
      const res = await fetch('/api/filebrowser/fs/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${appSandboxPath}/DEV.md`, content: devmdContent }),
      });
      if (res.ok) {
        setOriginalDevmd(devmdContent);
        setDevmdSaveStatus('saved');
      } else {
        setDevmdSaveStatus('unsaved');
      }
    } catch { setDevmdSaveStatus('unsaved'); }
    finally { setDevmdSaving(false); }
  };

  const handleDevmdKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveDevmd(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      setDevmdContent(devmdContent.substring(0, start) + '  ' + devmdContent.substring(end));
      setDevmdSaveStatus('unsaved');
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2; }, 0);
    }
  };

  // Secrets
  const loadSecrets = async () => {
    setSecretsLoading(true);
    try {
      const res = await fetch(`/api/apps/${appId}/secrets`);
      if (res.ok) setSecrets(await res.json());
    } catch (error) { console.error("Failed to load secrets:", error); }
    finally { setSecretsLoading(false); }
  };

  const addSecret = async () => {
    setSecretError(null);
    if (!newSecretKey.trim() || !newSecretValue.trim()) { setSecretError("Key and value are required"); return; }
    const key = newSecretKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) { setSecretError("Key must start with a letter (A-Z, 0-9, _)"); return; }
    try {
      const res = await fetch(`/api/apps/${appId}/secrets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newSecretValue.trim() }),
      });
      if (!res.ok) { setSecretError((await res.json()).error || "Failed"); return; }
      setNewSecretKey(""); setNewSecretValue(""); loadSecrets();
    } catch { setSecretError("Failed to add secret"); }
  };

  const updateSecret = async (key: string, value: string) => {
    try {
      await fetch(`/api/apps/${appId}/secrets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
      setEditingSecretKey(null); setEditingSecretValue(""); loadSecrets();
    } catch (error) { console.error("Failed to update secret:", error); }
  };

  const removeSecret = async (key: string) => {
    try {
      await fetch(`/api/apps/${appId}/secrets`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      loadSecrets();
    } catch (error) { console.error("Failed to delete secret:", error); }
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  // Delete app
  const handleDeleteApp = async () => {
    if (deleteConfirmName !== title) return;
    setIsDeleting(true);
    try {
      await fetch(`/api/apps/${appId}`, { method: 'DELETE' });
      setApps(prev => prev.filter(a => a.id !== appId));
      setShowDeleteModal(false);
      router.push('/');
    } catch (error) {
      console.error("Failed to delete app:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Chats
  const loadPastConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const res = await fetch(`/api/apps/${appId}/chats`);
      if (res.ok) {
        setPastConversations(await res.json());
      }
      setChatsLoaded(true);
    } catch (error) { console.error("Failed to load conversations:", error); }
    finally { setIsLoadingConversations(false); }
  };

  if (isPageLoading) {
    return <div className="document-container">{showLoadingIndicator && <div className="empty-state"><h2>Loading...</h2></div>}</div>;
  }

  if (!app) {
    return <div className="document-container"><div className="empty-state">App not found</div></div>;
  }

  return (
    <div className="document-container">
      <div className="document-editor">
        <div className="document-header">
          <input
            type="text"
            className="document-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled App"
          />
          <div className="document-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TabBar
              tabs={[
                { id: 'chats' as Tab, label: 'Chats', icon: <MessageSquare size={16} /> },
                { id: 'readme' as Tab, label: 'README', icon: <FileText size={16} /> },
                { id: 'devmd' as Tab, label: 'DEV', icon: <Code size={16} /> },
                { id: 'files' as Tab, label: 'Files', icon: <Folder size={16} /> },
                { id: 'secrets' as Tab, label: 'Secrets', icon: <Key size={16} /> },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              style={{ marginBottom: 0 }}
            />
            <div className="chat-menu-container" style={{ marginLeft: 'auto' }}>
              <button className="chat-menu-button" onClick={() => setShowMenu(!showMenu)} aria-label="More options">
                <MoreVertical size={20} />
              </button>
              {showMenu && (
                <>
                  <div className="chat-menu-overlay" onClick={() => setShowMenu(false)} />
                  <div className="chat-menu-dropdown">
                    <button className="chat-menu-item" onClick={() => { setShowMenu(false); setShowMoveToFolderModal(true); }}>
                      <FolderOpen size={16} /><span>Move</span>
                    </button>
                    <button className="chat-menu-item chat-menu-item-danger" onClick={() => {
                      setShowMenu(false);
                      setDeleteConfirmName("");
                      setShowDeleteModal(true);
                    }}>
                      <Trash2 size={16} /><span>Delete</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="me-page-content">
          {/* Chats Tab */}
          {activeTab === 'chats' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ marginBottom: '16px' }}>
                <Button onClick={() => router.push(`/?appId=${appId}`)} icon={<Sparkles size={16} />} fullWidth={false}>
                  + Chat
                </Button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {isLoadingConversations ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>Loading...</div>
                ) : pastConversations.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>
                    No conversations yet. Click "+ Chat" to start one with this app's context.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {pastConversations.map((conv) => (
                      <div key={conv.id} className="past-chat-item" onClick={() => router.push(`/chat/${conv.id}`)}>
                        <MessageSquare size={16} color="var(--text-muted)" />
                        <div className="past-chat-title">{conv.title || 'Untitled Chat'}</div>
                        <div className="past-chat-date" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} />{formatDate(conv.updated_at)}
                        </div>
                        <ArrowRight size={14} color="var(--text-muted)" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* README Tab */}
          {activeTab === 'readme' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} />
                  {readmeSaveStatus === 'saving' ? 'Saving...' : readmeSaveStatus === 'saved' ? 'Saved' : readmeSaveStatus === 'unsaved' ? 'Unsaved' : ''}
                </div>
                <Button onClick={saveReadme} icon={<Save size={14} />} disabled={readmeSaving || readmeContent === originalReadme} fullWidth={false}>
                  Save
                </Button>
              </div>
              {readmeLoading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>Loading...</div>
              ) : (
                <textarea
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6,
                    background: 'transparent', border: 'none', padding: 0,
                    color: 'var(--text-primary)', resize: 'none', outline: 'none',
                    minHeight: '300px',
                  }}
                  value={readmeContent}
                  onChange={(e) => { setReadmeContent(e.target.value); setReadmeSaveStatus(e.target.value === originalReadme ? 'saved' : 'unsaved'); }}
                  onKeyDown={handleReadmeKeyDown}
                  spellCheck={false}
                  placeholder="# App Name\n\nDescribe your app here..."
                />
              )}
            </div>
          )}

          {/* DEV.md Tab */}
          {activeTab === 'devmd' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} />
                  {devmdSaveStatus === 'saving' ? 'Saving...' : devmdSaveStatus === 'saved' ? 'Saved' : devmdSaveStatus === 'unsaved' ? 'Unsaved' : ''}
                </div>
                <Button onClick={saveDevmd} icon={<Save size={14} />} disabled={devmdSaving || devmdContent === originalDevmd} fullWidth={false}>
                  Save
                </Button>
              </div>
              {devmdLoading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>Loading...</div>
              ) : (
                <textarea
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6,
                    background: 'transparent', border: 'none', padding: 0,
                    color: 'var(--text-primary)', resize: 'none', outline: 'none',
                    minHeight: '300px',
                  }}
                  value={devmdContent}
                  onChange={(e) => { setDevmdContent(e.target.value); setDevmdSaveStatus(e.target.value === originalDevmd ? 'saved' : 'unsaved'); }}
                  onKeyDown={handleDevmdKeyDown}
                  spellCheck={false}
                  placeholder="# Development Notes\n\nAdd development notes here..."
                />
              )}
            </div>
          )}

          {/* Files Tab */}
          {activeTab === 'files' && (
            <FileBrowserContent basePath={`apps/${appId}`} autoCreateDir />
          )}

          {/* Secrets Tab */}
          {activeTab === 'secrets' && (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input type="text" placeholder="KEY_NAME" value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                  style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'monospace', outline: 'none' }} />
                <input type="text" placeholder="Secret value" value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSecret(); }}
                  style={{ flex: 2, padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
                <Button variant="brand" icon={<Plus size={14} />} onClick={addSecret} fullWidth={false}>Add</Button>
              </div>
              {secretError && <div style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: '12px' }}>{secretError}</div>}
              {secretsLoading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>Loading...</div>
              ) : secrets.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>
                  No secrets configured. Add environment variables above.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {secrets.map(secret => (
                    <div key={secret.key} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
                      background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '8px',
                    }}>
                      <Key size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, minWidth: '100px' }}>{secret.key}</span>
                      {editingSecretKey === secret.key ? (
                        <input type="text" value={editingSecretValue} onChange={(e) => setEditingSecretValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') updateSecret(secret.key, editingSecretValue); if (e.key === 'Escape') setEditingSecretKey(null); }}
                          onBlur={() => updateSecret(secret.key, editingSecretValue)} autoFocus
                          style={{ flex: 1, padding: '2px 6px', fontFamily: 'monospace', fontSize: '0.85rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', outline: 'none' }} />
                      ) : (
                        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}
                          onClick={() => { setEditingSecretKey(secret.key); setEditingSecretValue(secret.value); }}>
                          {revealedKeys.has(secret.key) ? secret.value : '\u2022'.repeat(Math.min(secret.value.length, 20))}
                        </span>
                      )}
                      <button onClick={() => toggleReveal(secret.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex' }}>
                        {revealedKeys.has(secret.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button onClick={() => removeSecret(secret.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <MoveToFolderModal
        isOpen={showMoveToFolderModal}
        onClose={() => setShowMoveToFolderModal(false)}
        currentFolderId={app?.folder_id ?? null}
        folders={folders}
        onMove={(folderId) => moveAppToFolder(appId, folderId)}
      />

      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeleteConfirmName(""); }}
        title="Delete App"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setDeleteConfirmName(""); }} fullWidth={false}>
              Cancel
            </Button>
            <Button
              onClick={handleDeleteApp}
              isLoading={isDeleting}
              fullWidth={false}
              disabled={deleteConfirmName !== title}
              style={{ background: 'var(--error, #e55)', borderColor: 'var(--error, #e55)' }}
            >
              Delete Forever
            </Button>
          </div>
        }
      >
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.6 }}>
            This will permanently delete the app <strong style={{ color: 'var(--text-primary)' }}>{title}</strong>, all its files, secrets, and linked conversations. This action cannot be undone.
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Type <strong style={{ color: 'var(--text-primary)' }}>{title}</strong> to confirm:
          </p>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && deleteConfirmName === title) handleDeleteApp(); }}
            placeholder={title}
            style={{
              width: '100%', padding: '10px 14px', fontSize: '0.95rem',
              border: '1px solid var(--border)', borderRadius: '8px',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              outline: 'none', boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}
