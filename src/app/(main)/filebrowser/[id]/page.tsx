"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useChatContext } from "../../../context/ChatContext";
import { ArrowLeft, Folder, FileText, Save, Clock, FilePlus, FolderPlus, Check, X, Trash2, Upload, Pencil } from "lucide-react";
import { Button } from "../../../components/primitive/Button";
import "../../../components/FileBrowser.module.css";

interface FileBrowserData {
  id: string;
  title: string;
  current_path: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileBrowserPage() {
  const params = useParams();
  const router = useRouter();
  const fileBrowserId = params.id as string;
  const { setFileBrowsers, setDeleteConfirm } = useChatContext();

  const [fileBrowser, setFileBrowser] = useState<FileBrowserData | null>(null);
  const [title, setTitle] = useState("");
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);

  // Directory view state
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [dirError, setDirError] = useState<string | null>(null);
  const [isListingLoading, setIsListingLoading] = useState(false);

  // Editor view state
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Create file/folder state
  const [createMode, setCreateMode] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Rename state
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  // Load file browser data
  useEffect(() => {
    if (fileBrowserId) {
      setIsPageLoading(true);
      setShowLoadingIndicator(false);
      const loadingTimer = setTimeout(() => setShowLoadingIndicator(true), 1000);
      loadFileBrowser().finally(() => {
        clearTimeout(loadingTimer);
        setIsPageLoading(false);
        setShowLoadingIndicator(false);
      });
    }
  }, [fileBrowserId]);

  // Track last opened item
  useEffect(() => {
    if (fileBrowserId) {
      localStorage.setItem('lastOpenedItem', JSON.stringify({ type: 'filebrowser', id: fileBrowserId }));
    }
  }, [fileBrowserId]);

  // Load directory when currentPath changes
  useEffect(() => {
    if (!isPageLoading && fileBrowser) {
      loadDirectory(currentPath);
    }
  }, [currentPath, isPageLoading, fileBrowser]);

  const loadFileBrowser = async () => {
    try {
      const res = await fetch(`/api/filebrowser/${fileBrowserId}`);
      if (res.status === 404) {
        router.push('/');
        return;
      }
      const data = await res.json();
      setFileBrowser(data);
      setTitle(data.title);
      setCurrentPath(data.current_path || '/');
    } catch (error) {
      console.error("Failed to load file browser:", error);
      router.push('/');
    }
  };

  const loadDirectory = async (dirPath: string) => {
    setIsListingLoading(true);
    setDirError(null);
    try {
      const res = await fetch(`/api/filebrowser/fs/list?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (!res.ok) {
        setDirError(data.error || "Failed to list directory");
        setEntries([]);
        return;
      }
      // Sort: directories first, then alphabetical
      const sorted = (data.entries as DirectoryEntry[]).sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
    } catch (error: any) {
      setDirError(error.message || "Failed to list directory");
      setEntries([]);
    } finally {
      setIsListingLoading(false);
    }
  };

  const navigateToDir = async (dirPath: string) => {
    setEditingFile(null);
    setCurrentPath(dirPath);
    // Persist the path
    try {
      await fetch(`/api/filebrowser/${fileBrowserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_path: dirPath }),
      });
    } catch {
      // Non-critical, don't block navigation
    }
  };

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      navigateToDir(newPath);
    } else {
      openFile(entry.name);
    }
  };

  const openFile = async (fileName: string) => {
    const filePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
    setFileError(null);
    try {
      const res = await fetch(`/api/filebrowser/fs/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || "Failed to read file";
        if (errMsg.includes('too large')) {
          setFileError(`"${fileName}" is too large to edit`);
        } else {
          setFileError(errMsg);
        }
        return;
      }
      // Detect binary content (null bytes)
      if (data.content && data.content.includes('\0')) {
        setFileError(`"${fileName}" is a binary file and cannot be edited`);
        return;
      }
      setEditingFile(filePath);
      setFileContent(data.content);
      setOriginalContent(data.content);
      setSaveStatus('saved');
    } catch (error: any) {
      setFileError(error.message || "Failed to read file");
    }
  };

  const handleSave = async () => {
    if (!editingFile) return;
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/filebrowser/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editingFile, content: fileContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFileError(data.error || "Failed to save file");
        setSaveStatus('unsaved');
        return;
      }
      setOriginalContent(fileContent);
      setSaveStatus('saved');
      setFileError(null);
    } catch (error: any) {
      setFileError(error.message || "Failed to save file");
      setSaveStatus('unsaved');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createMode) return;
    const name = createName.trim();
    // Basic name validation
    if (name.includes('/') || name === '.' || name === '..') {
      setFileError('Invalid name');
      return;
    }
    const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    setIsCreating(true);
    setFileError(null);
    try {
      if (createMode === 'folder') {
        const res = await fetch('/api/filebrowser/fs/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath }),
        });
        if (!res.ok) {
          const data = await res.json();
          setFileError(data.error || 'Failed to create folder');
          return;
        }
      } else {
        const res = await fetch('/api/filebrowser/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath, content: '' }),
        });
        if (!res.ok) {
          const data = await res.json();
          setFileError(data.error || 'Failed to create file');
          return;
        }
      }
      setCreateMode(null);
      setCreateName("");
      await loadDirectory(currentPath);
    } catch (error: any) {
      setFileError(error.message || 'Failed to create');
    } finally {
      setIsCreating(false);
    }
  };

  const cancelCreate = () => {
    setCreateMode(null);
    setCreateName("");
  };

  const handleDelete = async (entryName: string) => {
    const targetPath = currentPath === '/' ? `/${entryName}` : `${currentPath}/${entryName}`;
    setFileError(null);
    try {
      const res = await fetch('/api/filebrowser/fs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFileError(data.error || 'Failed to delete');
        return;
      }
      setDeleteTarget(null);
      await loadDirectory(currentPath);
    } catch (error: any) {
      setFileError(error.message || 'Failed to delete');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setFileError(null);

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', currentPath);

        const res = await fetch('/api/filebrowser/fs/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          setFileError(data.error || `Failed to upload ${file.name}`);
          break;
        }
      }
      await loadDirectory(currentPath);
    } catch (error: any) {
      setFileError(error.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRename = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) {
      setRenameTarget(null);
      return;
    }

    const trimmedName = newName.trim();
    if (trimmedName.includes('/') || trimmedName === '.' || trimmedName === '..') {
      setFileError('Invalid name');
      return;
    }

    const oldPath = currentPath === '/' ? `/${oldName}` : `${currentPath}/${oldName}`;
    const newPath = currentPath === '/' ? `/${trimmedName}` : `${currentPath}/${trimmedName}`;

    setFileError(null);
    try {
      const res = await fetch('/api/filebrowser/fs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      });

      if (!res.ok) {
        const data = await res.json();
        setFileError(data.error || 'Failed to rename');
        return;
      }

      setRenameTarget(null);
      await loadDirectory(currentPath);
    } catch (error: any) {
      setFileError(error.message || 'Failed to rename');
    }
  };

  const startRename = (entryName: string) => {
    setRenameTarget(entryName);
    setRenameName(entryName);
    setDeleteTarget(null);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFileContent(e.target.value);
    setSaveStatus(e.target.value === originalContent ? 'saved' : 'unsaved');
  };

  const handleTitleChange = useCallback(async (newTitle: string) => {
    setTitle(newTitle);
    try {
      await fetch(`/api/filebrowser/${fileBrowserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      setFileBrowsers((prev: any[]) =>
        prev.map((fb: any) => fb.id === fileBrowserId ? { ...fb, title: newTitle } : fb)
      );
    } catch {
      // Non-critical
    }
  }, [fileBrowserId, setFileBrowsers]);

  // Debounce title save
  const [titleTimeout, setTitleTimeout] = useState<NodeJS.Timeout | null>(null);
  const onTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    if (titleTimeout) clearTimeout(titleTimeout);
    setTitleTimeout(setTimeout(() => handleTitleChange(val), 1000));
  };

  // Build breadcrumb segments
  const breadcrumbSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  const goUp = () => {
    if (currentPath === '/') return;
    const segments = currentPath.split('/').filter(Boolean);
    segments.pop();
    navigateToDir(segments.length === 0 ? '/' : '/' + segments.join('/'));
  };

  // Handle Ctrl+S in editor
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = fileContent.substring(0, start) + '  ' + fileContent.substring(end);
      setFileContent(newContent);
      setSaveStatus('unsaved');
      // Restore cursor position
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  return (
    <div className="filebrowser-container">
      {isPageLoading ? (
        showLoadingIndicator ? (
          <div className="empty-state">
            <div className="empty-state-icon">📁</div>
            <h2>Loading...</h2>
          </div>
        ) : null
      ) : editingFile ? (
        // Editor View
        <div className="filebrowser-editor">
          <div className="filebrowser-header">
            <input
              type="text"
              className="filebrowser-title-input"
              value={title}
              onChange={onTitleChange}
              placeholder="File Browser"
            />
          </div>
          <div className="filebrowser-editor-header">
            <button className="filebrowser-back-btn" onClick={() => setEditingFile(null)} title="Back to directory">
              <ArrowLeft size={18} />
            </button>
            <span className="filebrowser-editor-path">{editingFile}</span>
            <div className="filebrowser-save-status">
              <Clock size={12} />
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Unsaved'}
            </div>
          </div>
          {fileError && <div className="filebrowser-error">{fileError}</div>}
          <textarea
            className="filebrowser-textarea"
            value={fileContent}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          <div className="filebrowser-save-bar">
            <Button
              onClick={handleSave}
              icon={<Save size={14} />}
              disabled={isSaving || saveStatus === 'saved'}
              fullWidth={false}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        // Directory View
        <div className="filebrowser-editor">
          <div className="filebrowser-header">
            <input
              type="text"
              className="filebrowser-title-input"
              value={title}
              onChange={onTitleChange}
              placeholder="File Browser"
            />
          </div>

          {/* Breadcrumb + actions row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <div className="filebrowser-breadcrumb" style={{ flex: 1, minWidth: 0, marginBottom: 0, height: 24 }}>
              <button
                className="filebrowser-breadcrumb-segment"
                onClick={() => navigateToDir('/')}
              >
                ~
              </button>
              {breadcrumbSegments.map((seg, i) => {
                const segPath = '/' + breadcrumbSegments.slice(0, i + 1).join('/');
                const isLast = i === breadcrumbSegments.length - 1;
                return (
                  <span key={segPath}>
                    <span className="filebrowser-breadcrumb-separator">/</span>
                    {isLast ? (
                      <span className="filebrowser-breadcrumb-current">{seg}</span>
                    ) : (
                      <button
                        className="filebrowser-breadcrumb-segment"
                        onClick={() => navigateToDir(segPath)}
                      >
                        {seg}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={handleUpload}
              />
              <button
                className="filebrowser-action-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Upload Files"
                disabled={isUploading}
                style={{ color: '#e0e0e0', marginBottom: -1 }}
              >
                <Upload size={16} />
              </button>
              <button
                className="filebrowser-action-btn"
                onClick={() => setCreateMode('folder')}
                title="New Folder"
                style={{ color: '#e0e0e0', marginBottom: -1 }}
              >
                <FolderPlus size={16} />
              </button>
              <button
                className="filebrowser-action-btn"
                onClick={() => setCreateMode('file')}
                title="New File"
                style={{ color: '#e0e0e0', marginBottom: 1 }}
              >
                <FilePlus size={16} />
              </button>
            </div>
          </div>

          {/* Inline create input */}
          {createMode && (
            <div className="filebrowser-create-input" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--accent)',
              borderRadius: '8px',
            }}>
              <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {createMode === 'folder' ? <FolderPlus size={14} /> : <FilePlus size={14} />}
              </span>
              <input
                type="text"
                placeholder={createMode === 'folder' ? 'Folder name...' : 'File name...'}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') cancelCreate();
                }}
                autoFocus
                disabled={isCreating}
                style={{
                  flex: 1,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleCreate}
                title="Create"
                disabled={isCreating || !createName.trim()}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px', borderRadius: '4px', display: 'flex',
                  alignItems: 'center', color: 'var(--text-muted)',
                }}
              >
                <Check size={16} />
              </button>
              <button
                onClick={cancelCreate}
                title="Cancel"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px', borderRadius: '4px', display: 'flex',
                  alignItems: 'center', color: 'var(--text-muted)',
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {isUploading && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--accent)',
              borderRadius: '8px',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
            }}>
              <Upload size={14} />
              Uploading...
            </div>
          )}

          {dirError ? (
            <div className="filebrowser-error">{dirError}</div>
          ) : isListingLoading ? (
            <div className="filebrowser-empty">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="filebrowser-empty">Empty directory</div>
          ) : (
            <div className="filebrowser-listing">
              {currentPath !== '/' && (
                <div className="filebrowser-entry" onClick={goUp}>
                  <span className="filebrowser-entry-icon directory">
                    <Folder size={16} />
                  </span>
                  <span className="filebrowser-entry-name">..</span>
                </div>
              )}
              {entries.map((entry) => (
                <div
                  key={entry.name}
                  className="filebrowser-entry"
                  onClick={() => {
                    if (deleteTarget !== entry.name && renameTarget !== entry.name) handleEntryClick(entry);
                  }}
                >
                  <span className={`filebrowser-entry-icon ${entry.isDirectory ? 'directory' : ''}`}>
                    {entry.isDirectory ? <Folder size={16} /> : <FileText size={16} />}
                  </span>
                  {deleteTarget === entry.name ? (
                    <>
                      <span className="filebrowser-entry-name" style={{ color: 'var(--error, #e55)' }}>
                        Delete &ldquo;{entry.name}&rdquo;?
                      </span>
                      <button
                        className="filebrowser-delete-btn filebrowser-delete-confirm"
                        onClick={(e) => { e.stopPropagation(); handleDelete(entry.name); }}
                      >
                        Yes
                      </button>
                      <button
                        className="filebrowser-delete-btn"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(null); }}
                      >
                        No
                      </button>
                    </>
                  ) : renameTarget === entry.name ? (
                    <>
                      <input
                        type="text"
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(entry.name, renameName);
                          if (e.key === 'Escape') setRenameTarget(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="filebrowser-rename-input"
                      />
                      <button
                        className="filebrowser-delete-btn"
                        onClick={(e) => { e.stopPropagation(); handleRename(entry.name, renameName); }}
                        title="Confirm"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        className="filebrowser-delete-btn"
                        onClick={(e) => { e.stopPropagation(); setRenameTarget(null); }}
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="filebrowser-entry-name">{entry.name}</span>
                      <span className="filebrowser-entry-meta">
                        {!entry.isDirectory && <span>{formatSize(entry.size)}</span>}
                        <span>{entry.modifiedAt}</span>
                      </span>
                      <button
                        className="filebrowser-delete-btn filebrowser-entry-action"
                        onClick={(e) => { e.stopPropagation(); startRename(entry.name); }}
                        title="Rename"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="filebrowser-delete-btn filebrowser-entry-action"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry.name); }}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {fileError && <div className="filebrowser-error" style={{ marginTop: 12 }}>{fileError}</div>}
        </div>
      )}
    </div>
  );
}
