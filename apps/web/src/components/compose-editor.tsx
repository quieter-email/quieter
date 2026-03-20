"use client";

import {
  ArrowTurnBackwardIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  QuoteUpIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn, IconButtonTooltip } from "@quietr/ui";
import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { normalizeComposeBodyHtml } from "~/lib/gmail/compose";

const ComposeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-compose-inline-id": {
        default: null,
      },
    };
  },
});

type ComposeEditorProps = {
  html: string;
  disabled?: boolean;
  onChange: (payload: { html: string; text: string }) => void;
  onBlur?: () => void;
  onInlineImageFiles: (files: File[]) => void | Promise<void>;
};

export const ComposeEditor = ({
  disabled,
  html,
  onBlur,
  onChange,
  onInlineImageFiles,
}: ComposeEditorProps) => {
  const lastSyncedHtmlRef = useRef(html);
  const editorPlaceholderClassName = "min-h-72 text-[15px] leading-[1.75] text-muted-foreground/75";

  const editor = useEditor({
    autofocus: false,
    content: html.trim(),
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "min-h-72 bg-transparent text-[15px] leading-[1.75] text-foreground outline-none [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-[15px] [&_.is-editor-empty:first-child::before]:leading-[1.75] [&_.is-editor-empty:first-child::before]:text-muted-foreground/75 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_a]:text-foreground [&_a]:underline [&_blockquote]:my-4 [&_blockquote]:border-l [&_blockquote]:border-border/70 [&_blockquote]:pl-4 [&_blockquote]:text-foreground-light [&_img]:my-4 [&_img]:max-h-64 [&_img]:max-w-full [&_img]:rounded-xl [&_img]:object-contain [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_p+p]:mt-3 [&_s]:text-foreground-light [&_strong]:font-semibold [&_u]:underline [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Underline,
      Link.configure({
        openOnClick: true,
        autolink: true,
        defaultProtocol: "https",
      }),
      Placeholder.configure({
        placeholder: "Write your message...",
      }),
      ComposeImage.configure({
        inline: false,
        allowBase64: true,
      }),
      FileHandler.configure({
        onDrop: (_editor, files) => {
          const imageFiles = files.filter((file) => file.type.startsWith("image/"));
          void onInlineImageFiles(imageFiles);
        },
        onPaste: (_editor, files) => {
          const imageFiles = files.filter((file) => file.type.startsWith("image/"));
          void onInlineImageFiles(imageFiles);
        },
      }),
    ],
    immediatelyRender: false,
    onBlur: () => onBlur?.(),
    onUpdate: ({ editor: updatedEditor }) => {
      lastSyncedHtmlRef.current = updatedEditor.getHTML();
      onChange({
        html: updatedEditor.getHTML(),
        text: updatedEditor.getText({ blockSeparator: "\n\n" }),
      });
    },
  });

  // Tiptap's useEditor with default deps merges options but preserves `editable`; toggling
  // `disabled` must call setEditable so the instance matches without recreating the editor.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;

    const current = normalizeComposeBodyHtml(editor.getHTML());
    const next = normalizeComposeBodyHtml(html);

    if (current === next || normalizeComposeBodyHtml(lastSyncedHtmlRef.current) === next) return;
    editor.commands.setContent(next || "<p></p>", { emitUpdate: false });
    lastSyncedHtmlRef.current = editor.getHTML();
  }, [editor, html]);

  const toolbarActions = [
    {
      id: "bold",
      label: "Bold",
      icon: TextBoldIcon,
      active: Boolean(editor?.isActive("bold")),
      disabled: !editor?.can().chain().focus().toggleBold().run(),
      onClick: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      id: "italic",
      label: "Italic",
      icon: TextItalicIcon,
      active: Boolean(editor?.isActive("italic")),
      disabled: !editor?.can().chain().focus().toggleItalic().run(),
      onClick: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      id: "underline",
      label: "Underline",
      icon: TextUnderlineIcon,
      active: Boolean(editor?.isActive("underline")),
      disabled: !editor?.can().chain().focus().toggleUnderline().run(),
      onClick: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      id: "bullet-list",
      label: "Bullet list",
      icon: LeftToRightListBulletIcon,
      active: Boolean(editor?.isActive("bulletList")),
      disabled: !editor?.can().chain().focus().toggleBulletList().run(),
      onClick: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      label: "Ordered list",
      icon: LeftToRightListNumberIcon,
      active: Boolean(editor?.isActive("orderedList")),
      disabled: !editor?.can().chain().focus().toggleOrderedList().run(),
      onClick: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "quote",
      label: "Quote",
      icon: QuoteUpIcon,
      active: Boolean(editor?.isActive("blockquote")),
      disabled: !editor?.can().chain().focus().toggleBlockquote().run(),
      onClick: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "undo",
      label: "Undo",
      icon: ArrowTurnBackwardIcon,
      disabled: !editor?.can().chain().focus().undo().run(),
      onClick: () => editor?.chain().focus().undo().run(),
    },
    {
      id: "redo",
      label: "Redo",
      icon: ArrowTurnBackwardIcon,
      disabled: !editor?.can().chain().focus().redo().run(),
      onClick: () => editor?.chain().focus().redo().run(),
    },
  ];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        disabled && "pointer-events-none opacity-80",
      )}
    >
      <div className="px-4 py-4">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div aria-hidden className={editorPlaceholderClassName}>
            Write your message...
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 px-3 pb-3">
        {toolbarActions.map((action) => {
          const isDisabled = Boolean(disabled || action.disabled);

          return (
            <IconButtonTooltip key={action.id} label={action.label}>
              <button
                aria-label={action.label}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none",
                  action.active && "bg-muted/75 text-foreground",
                  isDisabled && "opacity-35 hover:bg-transparent hover:text-muted-foreground",
                )}
                disabled={isDisabled}
                onClick={() => action.onClick()}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                <HugeiconsIcon
                  className={cn("size-4", action.id === "redo" && "-scale-x-100")}
                  icon={action.icon}
                />
              </button>
            </IconButtonTooltip>
          );
        })}
      </div>
    </div>
  );
};
