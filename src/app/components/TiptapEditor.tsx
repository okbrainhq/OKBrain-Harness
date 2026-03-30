"use client";

import { useEditor, EditorContent, Editor, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Link } from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { createLowlight, all } from "lowlight";
import { useEffect, useRef, useState, useCallback } from "react";
import { Undo2, Redo2, Indent, Outdent, Ellipsis, Trash2 } from "lucide-react";
import { Button } from "./primitive/Button";
import { Modal } from "./primitive/Modal";
import "./primitive/ContentStyles.module.css";
import "./TiptapEditor.module.css";
import "highlight.js/styles/vs2015.css";

// Create lowlight instance and register all common languages
const lowlight = createLowlight(all);

// iOS Safari bug: double-space-to-period doesn't work in contenteditable
// elements with <p> children. This plugin reimplements it for iOS.
// See: https://github.com/ProseMirror/prosemirror/issues/234
const IOSDoubleSpacePeriod = Extension.create({
  name: 'iosDoubleSpacePeriod',

  addProseMirrorPlugins() {
    let lastSpaceTime = 0;

    return [
      new Plugin({
        key: new PluginKey('iosDoubleSpacePeriod'),
        props: {
          handleTextInput(view, from, to, text) {
            if (typeof navigator === 'undefined') return false;
            if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;

            if (text === ' ') {
              const now = Date.now();
              const timeSinceLastSpace = now - lastSpaceTime;
              lastSpaceTime = now;

              if (timeSinceLastSpace < 500 && from > 0) {
                const $pos = view.state.doc.resolve(from);
                const nodeBefore = $pos.nodeBefore;
                if (nodeBefore?.isText && nodeBefore.text?.endsWith(' ')) {
                  const tr = view.state.tr.replaceWith(
                    from - 1,
                    to,
                    view.state.schema.text('. ', nodeBefore.marks)
                  );
                  view.dispatch(tr);
                  lastSpaceTime = 0;
                  return true;
                }
              }
            } else {
              lastSpaceTime = 0;
            }

            return false;
          },
        },
      }),
    ];
  },
});

// Image drop & paste handler extension
const ImageDropPaste = Extension.create({
  name: 'imageDropPaste',

  addProseMirrorPlugins() {
    // Need access to the React method from outside.
    // We can rely on a global helper or pass editor if possible.
    // But extensions don't easily access react scope.
    // Instead, we can trigger an event or use editor.commands if we made a command.
    // For now, let's keep it simple: we'll use the editor instance from arguments.

    const handleFiles = async (files: File[], view: any, pos?: number) => {
      // Find the editor instance attached to the view.
      // Tiptap attaches it to view.dom usually? No.
      // We can use the view directly to dispatch transactions, but we need our custom upload logic.
      // Let's invoke a custom command if we can, or just do the logic here.

      const images = files.filter(f => f.type.startsWith('image/'));
      if (images.length === 0) return;

      for (const file of images) {
        await insertImageWithUpload(view, file, pos);
      }
    };

    return [
      new Plugin({
        key: new PluginKey('imageDropPaste'),
        props: {
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files || []);
            const images = files.filter(f => f.type.startsWith('image/'));
            if (images.length === 0) return false;

            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            handleFiles(images, view, pos);
            return true;
          },
          handlePaste(view, event) {
            const files = Array.from(event.clipboardData?.files || []);
            const images = files.filter(f => f.type.startsWith('image/'));
            if (images.length === 0) return false;

            event.preventDefault();
            handleFiles(images, view);
            return true;
          },
        },
      }),
    ];
  },
});

// Helper to handle upload flow with placeholder
async function insertImageWithUpload(view: any, file: File, pos?: number) {
  const id = Math.random().toString(36).substring(7);
  const blobUrl = URL.createObjectURL(file);

  // 1. Insert placeholder
  const tr = view.state.tr;
  const node = view.state.schema.nodes.image.create({
    src: blobUrl,
    uploading: true,
    id
  });

  const insertPos = pos ?? view.state.selection.from;
  tr.insert(insertPos, node);
  view.dispatch(tr);

  // 2. Upload
  try {
    const url = await uploadImage(file);

    // 3. Update node with real URL
    if (url) {
      // We need to find the node again because positions shift
      const { state } = view;
      let foundPos: number | null = null;

      state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'image' && node.attrs.id === id) {
          foundPos = pos;
          return false; // Stop iteration
        }
      });

      if (foundPos !== null) {
        const tr2 = view.state.tr.setNodeMarkup(foundPos, undefined, {
          ...node.attrs,
          src: url,
          uploading: false,
          id: null // Clear temp ID
        });
        view.dispatch(tr2);
      }
    }
  } catch (e) {
    console.error("Upload failed", e);
    // Optionally remove the node on failure
    const { state } = view;
    let foundPos: number | null = null;
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'image' && node.attrs.id === id) {
        foundPos = pos;
        return false;
      }
    });
    if (foundPos !== null) {
      const tr3 = view.state.tr.delete(foundPos, foundPos + 1);
      view.dispatch(tr3);
    }
  }
}

// Popular programming languages for the selector
const LANGUAGES = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'xml', label: 'XML' },
];

interface TiptapEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  editable?: boolean;
}

interface SlashMenuItem {
  icon: string;
  label: string;
  description: string;
  command: (editor: Editor) => void;
}

const slashMenuItems: SlashMenuItem[] = [
  {
    icon: "☐",
    label: "To-do list",
    description: "Track tasks with a to-do list",
    command: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    icon: "⊞",
    label: "Table",
    description: "Add a table",
    command: (editor) => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  {
    icon: "H1",
    label: "Heading 1",
    description: "Large section heading",
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    },
  },
  {
    icon: "H2",
    label: "Heading 2",
    description: "Medium section heading",
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    },
  },
  {
    icon: "H3",
    label: "Heading 3",
    description: "Small section heading",
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    },
  },
  {
    icon: "•",
    label: "Bulleted list",
    description: "Create a simple bulleted list",
    command: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    icon: "1.",
    label: "Numbered list",
    description: "Create a list with numbering",
    command: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    icon: "❝",
    label: "Quote",
    description: "Capture a quote",
    command: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    icon: "—",
    label: "Divider",
    description: "Visual divider",
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
  {
    icon: "🖼",
    label: "Image",
    description: "Upload an image",
    command: () => {
      // Handled specially in handleSlashSelect
    },
  },
  {
    icon: "</>",
    label: "Code block",
    description: "Add a code block",
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
];


function ImageNodeView({ node, selected }: { node: any; selected: boolean }) {
  const { src, width, uploading } = node.attrs;

  return (
    <NodeViewWrapper className="image-node-view" style={{ display: 'inline-block', position: 'relative', maxWidth: '100%' }}>
      <img
        src={src}
        className={`uploaded-image ${selected ? 'ProseMirror-selectednode' : ''}`}
        style={width ? { width } : {}}
        alt=""
      />
      {uploading && (
        <div className="image-uploading-overlay">
          <div className="upload-spinner" />
        </div>
      )}
    </NodeViewWrapper>
  );
}

function ImageTools({
  editor,
  position
}: {
  editor: Editor | null;
  position: { top: number; left: number } | null;
}) {
  if (!editor || !position) return null;

  const currentWidth = editor.getAttributes('image').width;

  const setWidth = (width: string | null) => {
    editor.chain().focus().updateAttributes('image', { width }).run();
  };

  return (
    <div
      className="image-tools"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
      }}
    >
      <div className="image-tools-group">
        <button
          className={`image-tools-btn ${currentWidth === '25%' ? 'active' : ''}`}
          onClick={() => setWidth('25%')}
          title="Small"
        >
          S
        </button>
        <button
          className={`image-tools-btn ${currentWidth === '50%' ? 'active' : ''}`}
          onClick={() => setWidth('50%')}
          title="Medium"
        >
          M
        </button>
        <button
          className={`image-tools-btn ${currentWidth === '75%' ? 'active' : ''}`}
          onClick={() => setWidth('75%')}
          title="Large"
        >
          L
        </button>
        <button
          className={`image-tools-btn ${!currentWidth || currentWidth === '100%' ? 'active' : ''}`}
          onClick={() => setWidth('100%')}
          title="Full"
        >
          Full
        </button>
      </div>
      <div className="image-tools-divider" />
      <button
        className="image-tools-btn danger"
        onClick={() => editor.chain().focus().deleteSelection().run()}
        title="Delete image"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function CodeBlockLanguageSelector({
  editor,
  position,
}: {
  editor: Editor | null;
  position: { top: number; left: number } | null;
}) {
  if (!editor || !position) return null;

  const currentLanguage = editor.getAttributes('codeBlock').language || 'plaintext';

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run();
  };

  return (
    <div
      className="code-block-language-selector"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 100,
      }}
    >
      <select
        value={currentLanguage}
        onChange={handleLanguageChange}
        className="language-select"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TableToolbar({
  editor,
  position
}: {
  editor: Editor | null;
  position: { top: number; left: number } | null;
}) {
  if (!editor || !position) return null;

  return (
    <div
      className="table-toolbar"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 100,
      }}
    >
      <div className="table-toolbar-group">
        <Button
          onClick={() => editor.chain().focus().addRowBefore().run()}
          title="Add row above"
          className="table-toolbar-btn"
          icon={<span>↑</span>}
        >
          Row
        </Button>
        <Button
          onClick={() => editor.chain().focus().addRowAfter().run()}
          title="Add row below"
          className="table-toolbar-btn"
          icon={<span>↓</span>}
        >
          Row
        </Button>
        <Button
          onClick={() => editor.chain().focus().deleteRow().run()}
          title="Delete row"
          className="table-toolbar-btn danger"
          variant="danger"
        >
          ✕ Row
        </Button>
      </div>
      <div className="table-toolbar-divider" />
      <div className="table-toolbar-group">
        <Button
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          title="Add column before"
          className="table-toolbar-btn"
          icon={<span>←</span>}
        >
          Col
        </Button>
        <Button
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          title="Add column after"
          className="table-toolbar-btn"
          icon={<span>→</span>}
        >
          Col
        </Button>
        <Button
          onClick={() => editor.chain().focus().deleteColumn().run()}
          title="Delete column"
          className="table-toolbar-btn danger"
          variant="danger"
        >
          ✕ Col
        </Button>
      </div>
      <div className="table-toolbar-divider" />
      <Button
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="Delete table"
        className="table-toolbar-btn danger"
        variant="danger"
      >
        🗑️ Table
      </Button>
    </div>
  );
}

function LinkDialog({
  isOpen,
  onClose,
  onSubmit,
  initialUrl,
  initialText,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string, text: string) => void;
  initialUrl: string;
  initialText: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState(initialText);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUrl(initialUrl);
      setText(initialText);
      // Focus the URL input after a brief delay to ensure the dialog is rendered
      setTimeout(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      }, 10);
    }
  }, [isOpen, initialUrl, initialText]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (url.trim()) {
          onSubmit(url, text);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, url, text, onSubmit]);

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} fullWidth={false}>
        Cancel
      </Button>
      <Button
        variant="brand"
        onClick={() => url.trim() && onSubmit(url, text)}
        disabled={!url.trim()}
        fullWidth={false}
      >
        Insert
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Insert Link"
      footer={footer}
      className="link-dialog"
    >
      <div className="link-dialog-body">
        <div className="link-dialog-field">
          <label htmlFor="link-url">URL</label>
          <input
            ref={urlInputRef}
            id="link-url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="link-dialog-field">
          <label htmlFor="link-text">Text (optional)</label>
          <input
            id="link-text"
            type="text"
            placeholder="Link text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function SlashMenu({
  isOpen,
  position,
  onSelect,
  onClose,
  filter,
}: {
  isOpen: boolean;
  position: { top: number; left: number };
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
  filter: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filteredItems = slashMenuItems.filter(
    (item) =>
      item.label.toLowerCase().includes(filter.toLowerCase()) ||
      item.description.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (filteredItems[selectedIndex]) {
          onSelect(filteredItems[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, selectedIndex, filteredItems, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (menuRef.current && isOpen) {
      const selectedElement = menuRef.current.querySelector(".slash-menu-item.selected");
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen || filteredItems.length === 0) return null;

  return (
    <div ref={menuRef} className="slash-menu" style={{ top: position.top, left: position.left }}>
      <div className="slash-menu-header">Basic blocks</div>
      {filteredItems.map((item, index) => (
        <div
          key={item.label}
          className={`slash-menu-item ${index === selectedIndex ? "selected" : ""}`}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="slash-menu-icon">{item.icon}</span>
          <div className="slash-menu-content">
            <span className="slash-menu-label">{item.label}</span>
            <span className="slash-menu-description">{item.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

async function uploadImage(file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Image upload failed:", error.error);
      return null;
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error("Image upload failed:", error);
    return null;
  }
}

export default function TiptapEditor({ value, onChange, placeholder, editable = true }: TiptapEditorProps) {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const [slashFilter, setSlashFilter] = useState("");
  const slashStartPos = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Link dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogUrl, setLinkDialogUrl] = useState("");
  const [linkDialogText, setLinkDialogText] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false, // Disable default code block to use CodeBlockLowlight
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({
        placeholder: placeholder || "Type '/' for commands...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({
        allowBase64: true,
        // Removed global HTMLAttributes class here because we handle it in NodeView now,
        // but keeping it might be safer for non-node-view contexts if any.
        // Tiptap Image extension usually renders an img tag.
        // We are overriding it with addNodeView.
      }).extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: element => element.getAttribute('width'),
              renderHTML: attributes => {
                if (!attributes.width) return {};
                return {
                  width: attributes.width,
                  style: `width: ${attributes.width}`,
                };
              },
            },
            uploading: {
              default: false,
              renderHTML: attributes => {
                if (!attributes.uploading) return {};
                return { 'data-uploading': attributes.uploading };
              }
            },
            id: {
              default: null,
            }
          };
        },
        addNodeView() {
          return ReactNodeViewRenderer(ImageNodeView);
        },
      }),
      IOSDoubleSpacePeriod,
      ImageDropPaste,
    ],
    content: initialValueRef.current,
    immediatelyRender: false,
    editable,
    onUpdate: ({ editor }) => {
      if (!editable || !onChange) return;
      const html = editor.getHTML();
      onChange(html);

      // Check for slash command
      const { state } = editor;
      const { selection } = state;
      const { from } = selection;

      // Get text before cursor
      const textBefore = state.doc.textBetween(Math.max(0, from - 10), from, "\n");

      if (textBefore.endsWith("/") && !slashMenuOpen) {
        const charBefore = textBefore.length > 1 ? textBefore[textBefore.length - 2] : "";
        if (charBefore === "" || charBefore === "\n" || charBefore === " " || textBefore === "/") {
          // Get cursor position
          const coords = editor.view.coordsAtPos(from);
          const wrapperRect = wrapperRef.current?.getBoundingClientRect();

          if (wrapperRect) {
            setSlashMenuPosition({
              top: coords.bottom - wrapperRect.top + 8,
              left: coords.left - wrapperRect.left,
            });
          }

          slashStartPos.current = from - 1;
          setSlashFilter("");
          setSlashMenuOpen(true);
        }
      } else if (slashMenuOpen && slashStartPos.current !== null) {
        const filterText = state.doc.textBetween(slashStartPos.current + 1, from, "");
        if (filterText.includes(" ") || filterText.includes("\n")) {
          setSlashMenuOpen(false);
          slashStartPos.current = null;
        } else {
          setSlashFilter(filterText);
        }
      }
    },
  });

  // Handle backspace to close menu
  useEffect(() => {
    if (!slashMenuOpen || !editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Backspace" && slashStartPos.current !== null) {
        const pos = editor.state.selection.from;
        if (pos <= slashStartPos.current + 1) {
          setSlashMenuOpen(false);
          slashStartPos.current = null;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [slashMenuOpen, editor]);

  const handleSlashSelect = useCallback(
    (item: SlashMenuItem) => {
      if (!editor) return;

      // Delete the slash and filter text
      if (slashStartPos.current !== null) {
        const from = slashStartPos.current;
        const to = editor.state.selection.from;
        editor.chain().focus().deleteRange({ from, to }).run();
      }

      // Handle Image specially via file input
      if (item.label === "Image") {
        imageInputRef.current?.click();
      } else {
        item.command(editor);
      }

      setSlashMenuOpen(false);
      setSlashFilter("");
      slashStartPos.current = null;
    },
    [editor]
  );

  const handleImageFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;

    await insertImageWithUpload(editor.view, file);

    // Reset so same file can be selected again
    e.target.value = "";
  }, [editor]);

  const handleCloseSlashMenu = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashFilter("");
    slashStartPos.current = null;
  }, []);

  // Link dialog handlers
  const handleOpenLinkDialog = useCallback(() => {
    if (!editor) return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");

    // Check if there's already a link
    const existingLink = editor.getAttributes("link");

    setLinkDialogUrl(existingLink.href || "");
    setLinkDialogText(selectedText);
    setLinkDialogOpen(true);
  }, [editor]);

  const handleCloseLinkDialog = useCallback(() => {
    setLinkDialogOpen(false);
    setLinkDialogUrl("");
    setLinkDialogText("");
  }, []);

  const handleSubmitLink = useCallback(
    (url: string, text: string) => {
      if (!editor) return;

      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, " ");

      // If there's selected text, just add the link
      if (selectedText) {
        editor.chain().focus().setLink({ href: url }).run();
      } else {
        // If no selection, insert text with link
        const linkText = text || url;
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${url}">${linkText}</a>`)
          .run();
      }

      handleCloseLinkDialog();
    },
    [editor, handleCloseLinkDialog]
  );

  // CTRL+K keyboard shortcut for link dialog
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        handleOpenLinkDialog();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editor, handleOpenLinkDialog]);

  // Floating link button for mobile/text selection
  const [showLinkButton, setShowLinkButton] = useState(false);
  const [linkButtonPosition, setLinkButtonPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!editor) return;

    const updateLinkButton = () => {
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;
      const isImage = editor.isActive('image');

      if (hasSelection && !isImage && wrapperRef.current) {
        // Get the coordinates of the selection
        const coords = editor.view.coordsAtPos(from);
        const wrapperRect = wrapperRef.current.getBoundingClientRect();

        setLinkButtonPosition({
          top: coords.top - wrapperRect.top - 45,
          left: coords.left - wrapperRect.left,
        });
        setShowLinkButton(true);
      } else {
        setShowLinkButton(false);
      }
    };

    editor.on("selectionUpdate", updateLinkButton);
    editor.on("blur", () => setShowLinkButton(false));

    return () => {
      editor.off("selectionUpdate", updateLinkButton);
    };
  }, [editor]);

  // Check if cursor is in a table and get table position
  const [isInTable, setIsInTable] = useState(false);
  const [tableToolbarPosition, setTableToolbarPosition] = useState<{ top: number; left: number } | null>(null);

  // Check if cursor is in a code block and get code block position
  const [isInCodeBlock, setIsInCodeBlock] = useState(false);
  const [codeBlockSelectorPosition, setCodeBlockSelectorPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!editor) return;

    const updateTableState = () => {
      const inTable = editor.isActive("table");
      setIsInTable(inTable);

      if (inTable && wrapperRef.current) {
        // Find the table element that contains the selection
        const { view } = editor;
        const { from } = view.state.selection;
        const domAtPos = view.domAtPos(from);
        let tableElement: HTMLTableElement | null = null;

        // Walk up the DOM to find the table
        let node = domAtPos.node as HTMLElement;
        while (node && node !== wrapperRef.current) {
          if (node.tagName === 'TABLE') {
            tableElement = node as HTMLTableElement;
            break;
          }
          node = node.parentElement as HTMLElement;
        }

        if (tableElement) {
          const wrapperRect = wrapperRef.current.getBoundingClientRect();
          const tableRect = tableElement.getBoundingClientRect();

          setTableToolbarPosition({
            top: tableRect.top - wrapperRect.top - 44, // 44px above the table
            left: tableRect.left - wrapperRect.left,
          });
        }
      } else {
        setTableToolbarPosition(null);
      }
    };

    const updateCodeBlockState = () => {
      const inCodeBlock = editor.isActive("codeBlock");
      setIsInCodeBlock(inCodeBlock);

      if (inCodeBlock && wrapperRef.current) {
        // Find the code block element that contains the selection
        const { view } = editor;
        const { from } = view.state.selection;
        const domAtPos = view.domAtPos(from);
        let codeBlockElement: HTMLElement | null = null;

        // Walk up the DOM to find the pre element
        let node = domAtPos.node as HTMLElement;
        while (node && node !== wrapperRef.current) {
          if (node.tagName === 'PRE') {
            codeBlockElement = node as HTMLElement;
            break;
          }
          node = node.parentElement as HTMLElement;
        }

        if (codeBlockElement) {
          const wrapperRect = wrapperRef.current.getBoundingClientRect();
          const codeBlockRect = codeBlockElement.getBoundingClientRect();

          setCodeBlockSelectorPosition({
            top: codeBlockRect.top - wrapperRect.top - 40, // 40px above the code block
            left: codeBlockRect.right - wrapperRect.left - 150, // Align to the right with some spacing
          });
        }
      } else {
        setCodeBlockSelectorPosition(null);
      }
    };

    editor.on("selectionUpdate", updateTableState);
    editor.on("focus", updateTableState);
    editor.on("selectionUpdate", updateCodeBlockState);
    editor.on("focus", updateCodeBlockState);

    return () => {
      editor.off("selectionUpdate", updateTableState);
      editor.off("focus", updateTableState);
      editor.off("selectionUpdate", updateCodeBlockState);
      editor.off("focus", updateCodeBlockState);
    };
  }, [editor]);

  // Check if cursor is on an image and get image position
  const [isInImage, setIsInImage] = useState(false);
  const [imageToolsPosition, setImageToolsPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!editor) return;

    const updateImageState = () => {
      const isImage = editor.isActive("image");
      setIsInImage(isImage);

      if (isImage && wrapperRef.current) {
        // Find the image element that is selected
        const { view } = editor;
        // For NodeSelection (images), the anchor is usually where the node starts
        const { from } = view.state.selection;

        // Try to find the node in DOM
        const node = view.nodeDOM(from) as HTMLElement;

        if (node && node.nodeType === 1) { // Element node
          const wrapperRect = wrapperRef.current.getBoundingClientRect();
          // With NodeViewWrapper, the image is inside. We need the wrapper's rect.
          // node is likely the NodeViewWrapper div now.
          const nodeRect = node.getBoundingClientRect();

          setImageToolsPosition({
            top: nodeRect.top - wrapperRect.top - 60,
            left: nodeRect.left - wrapperRect.left,
          });
        }
      } else {
        setImageToolsPosition(null);
      }
    };

    editor.on("selectionUpdate", updateImageState);
    editor.on("focus", updateImageState);

    return () => {
      editor.off("selectionUpdate", updateImageState);
      editor.off("focus", updateImageState);
    };
  }, [editor]);

  // Track editor focus for undo/redo toolbar with delayed blur
  const [editorFocused, setEditorFocused] = useState(false);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number } | null>(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);

  useEffect(() => {
    if (!editor) return;

    const onFocus = () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      setEditorFocused(true);
    };
    const onBlur = () => {
      blurTimeoutRef.current = setTimeout(() => {
        setEditorFocused(false);
      }, 150);
    };

    const updateToolbarPosition = () => {
      if (!wrapperRef.current) return;
      try {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        const lineHeight = coords.bottom - coords.top;

        // Position toolbar top so its collapsed bottom sits 2 lines above cursor
        // Collapsed height: undo(40) + gap(4) + toggle(40) + padding(8) = 92
        const collapsedHeight = 92;
        setToolbarPosition({
          top: Math.max(0, coords.top - wrapperRect.top - lineHeight * 2 - collapsedHeight),
        });
      } catch {
        setToolbarPosition(null);
      }
    };

    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    editor.on("selectionUpdate", updateToolbarPosition);
    editor.on("focus", updateToolbarPosition);
    editor.on("update", updateToolbarPosition);

    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
      editor.off("selectionUpdate", updateToolbarPosition);
      editor.off("focus", updateToolbarPosition);
      editor.off("update", updateToolbarPosition);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, [editor]);

  return (
    <div ref={wrapperRef} className="tiptap-wrapper content-styles">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
        onChange={handleImageFileSelect}
        style={{ display: "none" }}
      />
      <EditorContent editor={editor} className="tiptap-editor" />
      {editable && editor && editorFocused && (
        <div
          className="mobile-undo-redo"
          style={toolbarPosition != null ? {
            top: toolbarPosition.top,
          } : undefined}
        >
          <button
            className="mobile-undo-redo-btn"
            disabled={!editor.can().undo()}
            onPointerDown={(e) => {
              e.preventDefault();
              editor.chain().focus().undo().run();
            }}
            aria-label="Undo"
          >
            <Undo2 size={18} />
          </button>
          {toolbarExpanded && (
            <>
              <button
                className="mobile-undo-redo-btn"
                disabled={!editor.can().redo()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().redo().run();
                }}
                aria-label="Redo"
              >
                <Redo2 size={18} />
              </button>
              <div className="mobile-undo-redo-divider" />
              <button
                className="mobile-undo-redo-btn"
                disabled={!editor.can().sinkListItem('listItem') && !editor.can().sinkListItem('taskItem')}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (editor.can().sinkListItem('taskItem')) {
                    editor.chain().focus().sinkListItem('taskItem').run();
                  } else {
                    editor.chain().focus().sinkListItem('listItem').run();
                  }
                }}
                aria-label="Indent"
              >
                <Indent size={18} />
              </button>
              <button
                className="mobile-undo-redo-btn"
                disabled={!editor.can().liftListItem('listItem') && !editor.can().liftListItem('taskItem')}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (editor.can().liftListItem('taskItem')) {
                    editor.chain().focus().liftListItem('taskItem').run();
                  } else {
                    editor.chain().focus().liftListItem('listItem').run();
                  }
                }}
                aria-label="Outdent"
              >
                <Outdent size={18} />
              </button>
            </>
          )}
          <button
            className="mobile-undo-redo-btn mobile-undo-redo-toggle"
            onPointerDown={(e) => {
              e.preventDefault();
              setToolbarExpanded((v) => !v);
            }}
            aria-label={toolbarExpanded ? "Collapse toolbar" : "Expand toolbar"}
          >
            <Ellipsis size={18} />
          </button>
        </div>
      )}
      {editable && isInTable && <TableToolbar editor={editor} position={tableToolbarPosition} />}
      {editable && isInImage && <ImageTools editor={editor} position={imageToolsPosition} />}
      {editable && isInCodeBlock && <CodeBlockLanguageSelector editor={editor} position={codeBlockSelectorPosition} />}
      {editable && showLinkButton && linkButtonPosition && (
        <Button
          className="floating-link-button"
          style={{
            position: 'absolute',
            top: linkButtonPosition.top,
            left: linkButtonPosition.left,
            zIndex: 100,
          }}
          onClick={(e) => {
            e.preventDefault();
            handleOpenLinkDialog();
          }}
          onMouseDown={(e) => e.preventDefault()}
          fullWidth={false}
        >
          🔗
        </Button>
      )}
      <SlashMenu
        isOpen={slashMenuOpen}
        position={slashMenuPosition}
        onSelect={handleSlashSelect}
        onClose={handleCloseSlashMenu}
        filter={slashFilter}
      />
      <LinkDialog
        isOpen={linkDialogOpen}
        onClose={handleCloseLinkDialog}
        onSubmit={handleSubmitLink}
        initialUrl={linkDialogUrl}
        initialText={linkDialogText}
      />
    </div>
  );
}

