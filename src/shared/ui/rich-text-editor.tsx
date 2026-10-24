"use client";

import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { cn } from "../lib/cn";

export interface RichTextEditorProps {
  value: JSONContent | null;
  placeholder: string;
  /** Called with the new document, debounced while typing and immediately on blur. */
  onChange: (doc: JSONContent) => void;
  debounceMs?: number;
  label: string;
}

/**
 * Rich-text editor (Tiptap). Content is stored as ProseMirror JSON, never as HTML, and
 * rendered only through the editor schema.
 */
export function RichTextEditor({
  value,
  placeholder,
  onChange,
  debounceMs = 800,
  label,
}: RichTextEditorProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const flush = (editor: Editor) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      onChangeRef.current(editor.getJSON());
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? undefined,
    editorProps: {
      attributes: {
        class: "tiptap-content",
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        onChangeRef.current(editor.getJSON());
      }, debounceMs);
    },
    onBlur: ({ editor }) => flush(editor),
  });

  // Save pending edits when the editor unmounts (e.g. the panel closes).
  useEffect(() => {
    return () => {
      if (editor && timer.current) flush(editor);
    };
  }, [editor]);

  return (
    <div className="rounded-md border border-input bg-surface shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} className="px-3 py-2" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      heading: e.isActive("heading", { level: 2 }),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
    }),
  });

  const items = [
    { key: "bold", icon: Bold, run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", icon: Italic, run: () => editor.chain().focus().toggleItalic().run() },
    { key: "strike", icon: Strikethrough, run: () => editor.chain().focus().toggleStrike().run() },
    { key: "code", icon: Code, run: () => editor.chain().focus().toggleCode().run() },
    {
      key: "heading",
      icon: Heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    { key: "bulletList", icon: List, run: () => editor.chain().focus().toggleBulletList().run() },
    {
      key: "orderedList",
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    { key: "blockquote", icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
  ] as const;

  return (
    <div
      role="toolbar"
      aria-label={t("toolbar")}
      className="flex flex-wrap gap-0.5 border-b border-border px-1.5 py-1"
    >
      {items.map(({ key, icon: Icon, run }) => (
        <button
          key={key}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
          aria-pressed={state[key]}
          aria-label={t(key)}
          title={t(key)}
          className={cn(
            "flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            state[key] && "bg-accent text-accent-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
