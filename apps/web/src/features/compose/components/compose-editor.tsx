"use client";

import {
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  QuoteUpIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, IconButtonTooltip, TooltipGroup } from "@quieter/ui";
import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { normalizeComposeBodyHtml } from "../domain/draft";

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
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  onChange: (payload: { html: string; text: string }) => void;
  onBlur?: () => void;
  onInlineImageFiles: (files: File[]) => void | Promise<void>;
  showToolbar?: boolean;
};

export const ComposeEditor = ({
  className,
  compact = false,
  disabled,
  html,
  onBlur,
  onChange,
  onInlineImageFiles,
  showToolbar = true,
}: ComposeEditorProps) => {
  const lastSyncedHtmlRef = useRef(html);

  const editor = useEditor({
    autofocus: false,
    content: html.trim(),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: cn(
          "bg-transparent text-foreground outline-none [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground/75 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_a]:text-foreground [&_a]:underline [&_blockquote]:border-l [&_blockquote]:border-border/70 [&_blockquote]:text-muted-foreground [&_img]:max-w-full [&_img]:object-contain [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_s]:text-muted-foreground [&_strong]:font-semibold [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5",
          {
            "min-h-28 text-sm/relaxed [&_.is-editor-empty:first-child::before]:text-sm/relaxed [&_blockquote]:my-3 [&_blockquote]:pl-3 [&_img]:my-3 [&_img]:max-h-48 [&_img]:rounded-lg [&_li]:my-0.5 [&_ol]:my-3 [&_p+p]:mt-2 [&_ul]:my-3":
              compact,
            "min-h-72 text-[15px] leading-[1.75] [&_.is-editor-empty:first-child::before]:text-[15px] [&_.is-editor-empty:first-child::before]:leading-[1.75] [&_blockquote]:my-4 [&_blockquote]:pl-4 [&_img]:my-4 [&_img]:max-h-64 [&_img]:rounded-xl [&_li]:my-1 [&_ol]:my-4 [&_p+p]:mt-3 [&_ul]:my-4":
              !compact,
          },
        ),
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
        placeholder: "Write your message…",
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
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;

    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    const current = normalizeComposeBodyHtml(editor.getHTML());
    const next = normalizeComposeBodyHtml(html);

    if (current === next || normalizeComposeBodyHtml(lastSyncedHtmlRef.current) === next) return;
    editor.commands.setContent(next || "<p></p>", { emitUpdate: false });
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    lastSyncedHtmlRef.current = editor.getHTML();
  }, [editor, html]);

  const toolbarActions = [
    {
      id: "bold",
      label: "Bold",
      icon: TextBoldIcon,
      active: !!editor?.isActive("bold"),
      disabled: !editor?.can().chain().focus().toggleBold().run(),
      onClick: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      id: "italic",
      label: "Italic",
      icon: TextItalicIcon,
      active: !!editor?.isActive("italic"),
      disabled: !editor?.can().chain().focus().toggleItalic().run(),
      onClick: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      id: "underline",
      label: "Underline",
      icon: TextUnderlineIcon,
      active: !!editor?.isActive("underline"),
      disabled: !editor?.can().chain().focus().toggleUnderline().run(),
      onClick: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      id: "bullet-list",
      label: "Bullet list",
      icon: LeftToRightListBulletIcon,
      active: !!editor?.isActive("bulletList"),
      disabled: !editor?.can().chain().focus().toggleBulletList().run(),
      onClick: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      label: "Ordered list",
      icon: LeftToRightListNumberIcon,
      active: !!editor?.isActive("orderedList"),
      disabled: !editor?.can().chain().focus().toggleOrderedList().run(),
      onClick: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "quote",
      label: "Quote",
      icon: QuoteUpIcon,
      active: !!editor?.isActive("blockquote"),
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
      icon: ArrowTurnForwardIcon,
      disabled: !editor?.can().chain().focus().redo().run(),
      onClick: () => editor?.chain().focus().redo().run(),
    },
  ];

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        className,
        { "pointer-events-none opacity-80": disabled },
      )}
    >
      <div className={cn("min-h-0 flex-1 overflow-y-auto", compact ? "p-3" : "p-4")}>
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div
            aria-hidden
            className={cn("text-muted-foreground/75", {
              "min-h-28 text-sm/relaxed": compact,
              "min-h-72 text-[15px] leading-[1.75]": !compact,
            })}
          >
            Write your message…
          </div>
        )}
      </div>

      {showToolbar ? (
        <div className="flex shrink-0 items-center gap-1 px-3 pb-3">
          <TooltipGroup>
            {toolbarActions.map((action) => {
              const isDisabled = !!(disabled || action.disabled);

              return (
                <IconButtonTooltip key={action.id} label={action.label}>
                  <Button
                    aria-label={action.label}
                    aria-pressed={"active" in action ? action.active : undefined}
                    className={cn("text-muted-foreground hover:bg-muted/55 hover:text-foreground", {
                      "bg-muted/75 text-foreground": action.active,
                    })}
                    disabled={isDisabled}
                    onClick={() => action.onClick()}
                    onMouseDown={(event) => event.preventDefault()}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon className="size-4" icon={action.icon} />
                  </Button>
                </IconButtonTooltip>
              );
            })}
          </TooltipGroup>
        </div>
      ) : null}
    </div>
  );
};
