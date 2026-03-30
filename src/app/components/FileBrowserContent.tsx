"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Folder, FileText, Save, FilePlus, FolderPlus, Check, X, Trash2, Upload, Pencil, Clock } from "lucide-react";
import { Button } from "./primitive/Button";

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

interface FileBrowserContentProps {
  /** Base path prefix for all FS operations (e.g. "apps/<id>" or "/"). Paths are relative to sandbox home. */
  basePath: string;
  /** If true, auto-creates basePath directory when it doesn't exist */
  autoCreateDir?: boolean;
}

export default function FileBrowserContent({ basePath, autoCreateDir }: FileBrowserContentProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [dirError, setDirError] = useState<string | null>(null);
  const [isListingLoading, setIsListingLoading] = useState(false);

  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [createMode, setCreateMode] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  // Resolve a relative path to full sandbox path
  const resolvePath = (relPath: string) => {
    if (basePath === '/') return relPath;
    return relPath === '/' ? basePath : `${basePath}${relPath}`;
  };

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = async (dirPath: string) => {
    setIsListingLoading(true);
    setDirError(null);
    try {
      const fullPath = resolvePath(dirPath);
      const res = await fetch(`/api/filebrowser/fs/list?path=${encodeURIComponent(fullPath)}`);
      const data = await res.json();
      if (!res.ok) {
        if (autoCreateDir && (res.status === 404 || (data.error && data.error.includes('No such file')))) {
          await fetch('/api/filebrowser/fs/mkdir', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: basePath }),
          });
          setEntries([]);
          return;
        }
        setDirError(data.error || "Failed to list directory");
        setEntries([]);
        return;
      }
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

  const navigateToDir = (dirPath: string) => {
    setEditingFile(null);
    setCurrentPath(dirPath);
  };

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      navigateToDir(currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`);
    } else {
      openFile(entry.name);
    }
  };

  const openFile = async (fileName: string) => {
    const filePath = currentPath === '/' ? `${resolvePath('/')}/${fileName}` : `${resolvePath(currentPath)}/${fileName}`;
    setFileError(null);
    try {
      const res = await fetch(`/api/filebrowser/fs/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok) {
        setFileError(data.error || "Failed to read file");
        return;
      }
      if (data.content && data.content.includes('\0')) {
        setFileError(`"${fileName}" is a binary file and cannot be edited`);
        return;
      }
      setEditingFile(fileName);
      setFileContent(data.content);
      setOriginalContent(data.content);
      setSaveStatus('saved');
      setFileError(null);
    } catch (error: any) {
      setFileError(error.message || "Failed to read file");
    }
  };

  const handleSave = async () => {
    if (!editingFile) return;
    setIsSaving(true);
    setSaveStatus('saving');
    const filePath = currentPath === '/' ? `${resolvePath('/')}/${editingFile}` : `${resolvePath(currentPath)}/${editingFile}`;
    try {
      const res = await fetch('/api/filebrowser/fs/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: fileContent }),
      });
      if (!res.ok) { const data = await res.json(); setFileError(data.error || "Failed to save"); setSaveStatus('unsaved'); return; }
      setOriginalContent(fileContent);
      setSaveStatus('saved');
      setFileError(null);
    } catch (error: any) { setFileError(error.message || "Failed to save"); setSaveStatus('unsaved'); }
    finally { setIsSaving(false); }
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createMode) return;
    const name = createName.trim();
    if (name.includes('/') || name === '.' || name === '..') { setFileError('Invalid name'); return; }
    const targetPath = currentPath === '/' ? `${resolvePath('/')}/${name}` : `${resolvePath(currentPath)}/${name}`;
    setIsCreating(true);
    setFileError(null);
    try {
      if (createMode === 'folder') {
        await fetch('/api/filebrowser/fs/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: targetPath }) });
      } else {
        await fetch('/api/filebrowser/fs/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: targetPath, content: '' }) });
      }
      setCreateMode(null); setCreateName("");
      await loadDirectory(currentPath);
    } catch (error: any) { setFileError(error.message || 'Failed to create'); }
    finally { setIsCreating(false); }
  };

  const handleDelete = async (entryName: string) => {
    const targetPath = currentPath === '/' ? `${resolvePath('/')}/${entryName}` : `${resolvePath(currentPath)}/${entryName}`;
    setFileError(null);
    try {
      await fetch('/api/filebrowser/fs/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: targetPath }) });
      setDeleteTarget(null);
      await loadDirectory(currentPath);
    } catch (error: any) { setFileError(error.message || 'Failed to delete'); }
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
        formData.append('path', resolvePath(currentPath));
        await fetch('/api/filebrowser/fs/upload', { method: 'POST', body: formData });
      }
      await loadDirectory(currentPath);
    } catch (error: any) { setFileError(error.message || 'Upload failed'); }
    finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleRename = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) { setRenameTarget(null); return; }
    const trimmed = newName.trim();
    if (trimmed.includes('/') || trimmed === '.' || trimmed === '..') { setFileError('Invalid name'); return; }
    const oldPath = currentPath === '/' ? `${resolvePath('/')}/${oldName}` : `${resolvePath(currentPath)}/${oldName}`;
    const newPath = currentPath === '/' ? `${resolvePath('/')}/${trimmed}` : `${resolvePath(currentPath)}/${trimmed}`;
    setFileError(null);
    try {
      await fetch('/api/filebrowser/fs/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPath, newPath }) });
      setRenameTarget(null);
      await loadDirectory(currentPath);
    } catch (error: any) { setFileError(error.message || 'Failed to rename'); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = fileContent.substring(0, start) + '  ' + fileContent.substring(end);
      setFileContent(newContent);
      setSaveStatus('unsaved');
      setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = start + 2; }, 0);
    }
  };

  const goUp = () => {
    if (currentPath === '/') return;
    const segments = currentPath.split('/').filter(Boolean);
    segments.pop();
    navigateToDir(segments.length === 0 ? '/' : '/' + segments.join('/'));
  };

  const breadcrumbSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  if (editingFile) {
    return (
      <div className="filebrowser-editor">
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
          onChange={(e) => { setFileContent(e.target.value); setSaveStatus(e.target.value === originalContent ? 'saved' : 'unsaved'); }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <div className="filebrowser-save-bar">
          <Button onClick={handleSave} icon={<Save size={14} />} disabled={isSaving || saveStatus === 'saved'} fullWidth={false}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="filebrowser-editor">
      {/* Breadcrumb + actions row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div className="filebrowser-breadcrumb" style={{ flex: 1, minWidth: 0, marginBottom: 0, height: 24 }}>
          <button className="filebrowser-breadcrumb-segment" onClick={() => navigateToDir('/')}>~</button>
          {breadcrumbSegments.map((seg, i) => {
            const segPath = '/' + breadcrumbSegments.slice(0, i + 1).join('/');
            const isLast = i === breadcrumbSegments.length - 1;
            return (
              <span key={segPath}>
                <span className="filebrowser-breadcrumb-separator">/</span>
                {isLast ? (
                  <span className="filebrowser-breadcrumb-current">{seg}</span>
                ) : (
                  <button className="filebrowser-breadcrumb-segment" onClick={() => navigateToDir(segPath)}>{seg}</button>
                )}
              </span>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleUpload} />
          <button className="filebrowser-action-btn" onClick={() => fileInputRef.current?.click()} title="Upload Files" disabled={isUploading} style={{ color: '#e0e0e0', marginBottom: -1 }}><Upload size={16} /></button>
          <button className="filebrowser-action-btn" onClick={() => setCreateMode('folder')} title="New Folder" style={{ color: '#e0e0e0', marginBottom: -1 }}><FolderPlus size={16} /></button>
          <button className="filebrowser-action-btn" onClick={() => setCreateMode('file')} title="New File" style={{ color: '#e0e0e0', marginBottom: 0 }}><FilePlus size={16} /></button>
        </div>
      </div>

      {createMode && (
        <div className="filebrowser-create-input" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--accent)', borderRadius: '8px' }}>
          <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {createMode === 'folder' ? <FolderPlus size={14} /> : <FilePlus size={14} />}
          </span>
          <input type="text" placeholder={createMode === 'folder' ? 'Folder name...' : 'File name...'} value={createName} onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreateMode(null); setCreateName(''); } }}
            autoFocus disabled={isCreating}
            style={{ flex: 1, padding: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={handleCreate} title="Create" disabled={isCreating || !createName.trim()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}><Check size={16} /></button>
          <button onClick={() => { setCreateMode(null); setCreateName(''); }} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}><X size={16} /></button>
        </div>
      )}

      {isUploading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--accent)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <Upload size={14} /> Uploading...
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
              <span className="filebrowser-entry-icon directory"><Folder size={16} /></span>
              <span className="filebrowser-entry-name">..</span>
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.name} className="filebrowser-entry" onClick={() => { if (deleteTarget !== entry.name && renameTarget !== entry.name) handleEntryClick(entry); }}>
              <span className={`filebrowser-entry-icon ${entry.isDirectory ? 'directory' : ''}`}>
                {entry.isDirectory ? <Folder size={16} /> : <FileText size={16} />}
              </span>
              {deleteTarget === entry.name ? (
                <>
                  <span className="filebrowser-entry-name" style={{ color: 'var(--error, #e55)' }}>Delete &ldquo;{entry.name}&rdquo;?</span>
                  <button className="filebrowser-delete-btn filebrowser-delete-confirm" onClick={(e) => { e.stopPropagation(); handleDelete(entry.name); }}>Yes</button>
                  <button className="filebrowser-delete-btn" onClick={(e) => { e.stopPropagation(); setDeleteTarget(null); }}>No</button>
                </>
              ) : renameTarget === entry.name ? (
                <>
                  <input type="text" value={renameName} onChange={(e) => setRenameName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(entry.name, renameName); if (e.key === 'Escape') setRenameTarget(null); }}
                    onClick={(e) => e.stopPropagation()} autoFocus className="filebrowser-rename-input" />
                  <button className="filebrowser-delete-btn" onClick={(e) => { e.stopPropagation(); handleRename(entry.name, renameName); }} title="Confirm"><Check size={14} /></button>
                  <button className="filebrowser-delete-btn" onClick={(e) => { e.stopPropagation(); setRenameTarget(null); }} title="Cancel"><X size={14} /></button>
                </>
              ) : (
                <>
                  <span className="filebrowser-entry-name">{entry.name}</span>
                  <span className="filebrowser-entry-meta">
                    {!entry.isDirectory && <span>{formatSize(entry.size)}</span>}
                    <span>{entry.modifiedAt}</span>
                  </span>
                  <button className="filebrowser-delete-btn filebrowser-entry-action" onClick={(e) => { e.stopPropagation(); setRenameTarget(entry.name); setRenameName(entry.name); setDeleteTarget(null); }} title="Rename"><Pencil size={14} /></button>
                  <button className="filebrowser-delete-btn filebrowser-entry-action" onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry.name); }} title="Delete"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {fileError && <div className="filebrowser-error" style={{ marginTop: 12 }}>{fileError}</div>}
    </div>
  );
}
