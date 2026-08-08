"use client";

import type { Editor } from "@tiptap/core";
import {
  AiMicIcon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  QuoteUpIcon,
  StopIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from "@quieter/ui/toolbar";
import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  createContext,
  type ReactNode,
  type Ref,
  use,
  useEffect,
  useImperativeHandle,
  useMemo,
} from "react";
import { normalizeComposeBodyHtml } from "../domain/draft";
import {
  createTemplatePlaceholderToken,
  getSelectedTemplatePlaceholder,
  hydrateTemplatePlaceholders,
  TemplatePlaceholder,
  type TemplatePlaceholderRange,
} from "../domain/template-placeholders";

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

const audioWaveBars = [
  { id: "low-left", scale: 0.42 },
  { id: "mid-left", scale: 0.7 },
  { id: "peak-left", scale: 0.95 },
  { id: "soft-left", scale: 0.58 },
  { id: "peak-right", scale: 0.82 },
  { id: "soft-right", scale: 0.48 },
  { id: "mid-right", scale: 0.72 },
  { id: "low-right", scale: 0.52 },
];

type ComposeEditorProps = {
  children: ReactNode;
  html: string;
  density?: "comfortable" | "compact";
  disabled?: boolean;
  onChange: (payload: { html: string; text: string }) => void;
  onBlur?: () => void;
  onInlineImageFiles: (files: File[]) => void | Promise<void>;
  onPlaceholderSelectionChange?: (placeholder: TemplatePlaceholderRange | null) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  recording?: boolean;
  recordingSupported?: boolean;
  transcribing?: boolean;
  ref?: Ref<ComposeEditorHandle>;
};

export type ComposeEditorHandle = {
  insertHtml: (html: string) => void;
  insertPlaceholder: (label: string) => void;
  replaceSelectedPlaceholder: (value: string) => boolean;
};

type ComposeEditorContextValue = {
  density: NonNullable<ComposeEditorProps["density"]>;
  disabled: boolean;
  editor: Editor | null;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  recording: boolean;
  recordingSupported: boolean;
  transcribing: boolean;
};

const ComposeEditorContext = createContext<ComposeEditorContextValue | null>(null);

export const useComposeEditor = () => {
  const value = use(ComposeEditorContext);
  if (!value) throw new Error("Compose editor components must be inside ComposeEditor.");
  return value;
};

export const ComposeEditor = ({
  children,
  density = "comfortable",
  disabled,
  html,
  onBlur,
  onChange,
  onInlineImageFiles,
  onPlaceholderSelectionChange,
  onRecordingStart,
  onRecordingStop,
  recording = false,
  recordingSupported = false,
  transcribing = false,
  ref,
}: ComposeEditorProps) => {
  const editor = useEditor({
    autofocus: false,
    content: hydrateTemplatePlaceholders(html.trim()),
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "min-h-full bg-transparent text-sm text-fg outline-none [&_.ProseMirror-selectednode.quieter-template-placeholder]:border-fg [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-fg [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.quieter-template-placeholder]:mx-1 [&_.quieter-template-placeholder]:inline-block [&_.quieter-template-placeholder]:min-w-20 [&_.quieter-template-placeholder]:cursor-text [&_.quieter-template-placeholder]:border-b [&_.quieter-template-placeholder]:border-muted-fg [&_.quieter-template-placeholder]:px-1 [&_.quieter-template-placeholder]:text-transparent [&_.quieter-template-placeholder]:selection:bg-primary/20 [&_.quieter-template-placeholder]:hover:border-fg [&_a]:text-fg [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-fg [&_img]:my-3 [&_img]:max-h-48 [&_img]:max-w-full [&_img]:rounded-md [&_img]:object-contain [&_li]:my-0.5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_p+p]:mt-2 [&_s]:text-muted-fg [&_strong]:font-semibold [&_u]:underline [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: false,
        link: false,
        underline: false,
      }),
      TemplatePlaceholder,
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
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      onPlaceholderSelectionChange?.(getSelectedTemplatePlaceholder(updatedEditor));
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChange({
        html: updatedEditor.getHTML(),
        text: updatedEditor.getText({ blockSeparator: "\n\n" }),
      });
    },
  });

  useImperativeHandle(ref, () => ({
    insertHtml: (nextHtml) => {
      editor?.chain().focus().insertContent(nextHtml).run();
    },
    insertPlaceholder: (label) => {
      const token = createTemplatePlaceholderToken(label);
      if (!editor || !token) return;

      editor
        .chain()
        .focus()
        .insertContent({
          attrs: { label: token.slice("{{quieter:".length, -2) },
          type: "templatePlaceholder",
        })
        .run();
      editor.commands.setNodeSelection(editor.state.selection.from - 1);
    },
    replaceSelectedPlaceholder: (value) => {
      if (!editor) return false;
      const placeholder = getSelectedTemplatePlaceholder(editor);
      if (!placeholder) return false;

      return editor
        .chain()
        .focus()
        .insertContentAt({ from: placeholder.from, to: placeholder.to }, value)
        .run();
    },
  }));

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

    if (current === next) return;
    editor.commands.setContent(hydrateTemplatePlaceholders(next) || "<p></p>", {
      emitUpdate: false,
    });
  }, [editor, html]);

  const contextValue = useMemo(
    () => ({
      density,
      disabled: !!disabled,
      editor,
      onRecordingStart,
      onRecordingStop,
      recording,
      recordingSupported,
      transcribing,
    }),
    [
      density,
      disabled,
      editor,
      onRecordingStart,
      onRecordingStop,
      recording,
      recordingSupported,
      transcribing,
    ],
  );

  return (
    <ComposeEditorContext value={contextValue}>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </ComposeEditorContext>
  );
};

export const ComposeEditorBody = ({
  className,
  invalid = false,
}: {
  className?: string;
  invalid?: boolean;
}) => {
  const { density, disabled, editor, recording, transcribing } = useComposeEditor();
  const audioActive = recording || transcribing;

  return (
    <div
      aria-invalid={invalid || undefined}
      className={cn(
        "squircle relative min-h-20 w-full overflow-hidden rounded-md border border-border bg-bg-elevated text-sm text-fg shadow-sm transition-colors duration-150 ease-out",
        "has-[.ProseMirror:focus-visible]:border-ring has-[.ProseMirror:focus-visible]:ring-1 has-[.ProseMirror:focus-visible]:ring-ring/45 has-[.ProseMirror:focus-visible]:outline-none",
        "aria-invalid:border-destructive aria-invalid:focus-within:border-destructive aria-invalid:focus-within:ring-destructive/45",
        className,
        {
          "pointer-events-none opacity-50": disabled,
        },
      )}
    >
      {audioActive ? (
        <output
          aria-label={recording ? "Recording audio" : "Transcribing audio"}
          className={cn("flex h-full items-center justify-center px-4 py-3.5", {
            "min-h-28": density === "compact",
            "min-h-48": density === "comfortable",
          })}
        >
          <div className="flex h-10 items-center gap-1.5 rounded-full border border-border bg-secondary/35 px-4">
            {audioWaveBars.map((bar, index) => (
              <span
                className={cn("h-6 w-1 animate-pulse rounded-full bg-fg/75", {
                  "bg-primary": recording,
                  "bg-muted-fg": transcribing,
                })}
                key={bar.id}
                style={{
                  animationDelay: `${index * 70}ms`,
                  transform: `scaleY(${bar.scale})`,
                }}
              />
            ))}
          </div>
        </output>
      ) : editor ? (
        <EditorContent
          className="absolute inset-0 overflow-y-auto px-4 py-3.5 [&>.ProseMirror]:min-h-full"
          editor={editor}
        />
      ) : (
        <div
          aria-hidden
          className={cn("h-full px-4 py-3.5 text-muted-fg", {
            "min-h-28": density === "compact",
            "min-h-48": density === "comfortable",
          })}
        >
          Write your message…
        </div>
      )}
    </div>
  );
};

export const ComposeEditorToolbar = ({
  className,
  trailing,
}: {
  className?: string;
  trailing?: ReactNode;
}) => {
  const { disabled, editor } = useComposeEditor();
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      blockquoteActive: !!currentEditor?.isActive("blockquote"),
      boldActive: !!currentEditor?.isActive("bold"),
      bulletListActive: !!currentEditor?.isActive("bulletList"),
      canBlockquote: !!currentEditor?.can().chain().focus().toggleBlockquote().run(),
      canBold: !!currentEditor?.can().chain().focus().toggleBold().run(),
      canBulletList: !!currentEditor?.can().chain().focus().toggleBulletList().run(),
      canItalic: !!currentEditor?.can().chain().focus().toggleItalic().run(),
      canOrderedList: !!currentEditor?.can().chain().focus().toggleOrderedList().run(),
      canRedo: !!currentEditor?.can().chain().focus().redo().run(),
      canUnderline: !!currentEditor?.can().chain().focus().toggleUnderline().run(),
      canUndo: !!currentEditor?.can().chain().focus().undo().run(),
      italicActive: !!currentEditor?.isActive("italic"),
      orderedListActive: !!currentEditor?.isActive("orderedList"),
      underlineActive: !!currentEditor?.isActive("underline"),
    }),
  });

  const formatActions = [
    {
      id: "bold",
      label: "Bold",
      icon: TextBoldIcon,
      active: toolbarState?.boldActive,
      disabled: !toolbarState?.canBold,
      onClick: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      id: "italic",
      label: "Italic",
      icon: TextItalicIcon,
      active: toolbarState?.italicActive,
      disabled: !toolbarState?.canItalic,
      onClick: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      id: "underline",
      label: "Underline",
      icon: TextUnderlineIcon,
      active: toolbarState?.underlineActive,
      disabled: !toolbarState?.canUnderline,
      onClick: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      id: "bullet-list",
      label: "Bullet list",
      icon: LeftToRightListBulletIcon,
      active: toolbarState?.bulletListActive,
      disabled: !toolbarState?.canBulletList,
      onClick: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      label: "Ordered list",
      icon: LeftToRightListNumberIcon,
      active: toolbarState?.orderedListActive,
      disabled: !toolbarState?.canOrderedList,
      onClick: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "quote",
      label: "Quote",
      icon: QuoteUpIcon,
      active: toolbarState?.blockquoteActive,
      disabled: !toolbarState?.canBlockquote,
      onClick: () => editor?.chain().focus().toggleBlockquote().run(),
    },
  ] as const;

  return (
    <Toolbar
      className={cn("w-full min-w-0 shrink-0 rounded-md border-border bg-bg-elevated", className)}
    >
      <ToolbarGroup>
        {formatActions.map((action) => (
          <IconButtonTooltip key={action.id} label={action.label}>
            <ToolbarButton
              aria-label={action.label}
              aria-pressed={!!action.active}
              className={cn("size-8 px-0", {
                "bg-bg-surface text-fg shadow-sm": action.active,
              })}
              disabled={!!(disabled || action.disabled)}
              onClick={() => {
                action.onClick();
              }}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <HugeiconsIcon className="size-4" icon={action.icon} />
            </ToolbarButton>
          </IconButtonTooltip>
        ))}
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <IconButtonTooltip label="Undo">
          <ToolbarButton
            aria-label="Undo"
            className="size-8 px-0"
            disabled={!!(disabled || !toolbarState?.canUndo)}
            onClick={() => {
              editor?.chain().focus().undo().run();
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <HugeiconsIcon className="size-4" icon={ArrowTurnBackwardIcon} />
          </ToolbarButton>
        </IconButtonTooltip>
        <IconButtonTooltip label="Redo">
          <ToolbarButton
            aria-label="Redo"
            className="size-8 px-0"
            disabled={!!(disabled || !toolbarState?.canRedo)}
            onClick={() => {
              editor?.chain().focus().redo().run();
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <HugeiconsIcon className="size-4" icon={ArrowTurnForwardIcon} />
          </ToolbarButton>
        </IconButtonTooltip>
      </ToolbarGroup>
      {trailing ? <div className="ml-auto flex min-w-0 items-center gap-1">{trailing}</div> : null}
    </Toolbar>
  );
};

export const ComposeEditorDictationButton = () => {
  const {
    disabled,
    onRecordingStart,
    onRecordingStop,
    recording,
    recordingSupported,
    transcribing,
  } = useComposeEditor();

  return recording ? (
    <IconButtonTooltip label="Stop recording">
      <ToolbarButton
        aria-label="Stop recording"
        className="text-primary"
        disabled={disabled}
        onClick={onRecordingStop}
        onMouseDown={(event) => event.preventDefault()}
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={StopIcon} />
        Stop
      </ToolbarButton>
    </IconButtonTooltip>
  ) : (
    <IconButtonTooltip label={recordingSupported ? "Dictate" : "Recording unavailable"}>
      <ToolbarButton
        aria-label={recordingSupported ? "Dictate" : "Recording unavailable"}
        className="size-8 px-0"
        disabled={disabled || transcribing || !recordingSupported}
        onClick={onRecordingStart}
        onMouseDown={(event) => event.preventDefault()}
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={AiMicIcon} />
      </ToolbarButton>
    </IconButtonTooltip>
  );
};
