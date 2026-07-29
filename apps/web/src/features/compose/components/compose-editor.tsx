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
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { TooltipGroup } from "@quieter/ui/tooltip";
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
        class: cn(
          "bg-transparent text-foreground outline-none [&_.ProseMirror-selectednode.quieter-template-placeholder]:border-foreground [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground/75 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.quieter-template-placeholder]:mx-1 [&_.quieter-template-placeholder]:inline-block [&_.quieter-template-placeholder]:min-w-20 [&_.quieter-template-placeholder]:cursor-text [&_.quieter-template-placeholder]:border-b [&_.quieter-template-placeholder]:border-muted-foreground [&_.quieter-template-placeholder]:px-1 [&_.quieter-template-placeholder]:text-transparent [&_.quieter-template-placeholder]:selection:bg-primary/20 [&_.quieter-template-placeholder]:hover:border-foreground [&_a]:text-foreground [&_a]:underline [&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_img]:max-w-full [&_img]:object-contain [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_s]:text-muted-foreground [&_strong]:font-semibold [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5",
          {
            "min-h-28 text-sm/relaxed [&_.is-editor-empty:first-child::before]:text-sm/relaxed [&_blockquote]:my-3 [&_blockquote]:pl-3 [&_img]:my-3 [&_img]:max-h-48 [&_img]:rounded-lg [&_li]:my-0.5 [&_ol]:my-3 [&_p+p]:mt-2 [&_ul]:my-3":
              density === "compact",
            "min-h-72 text-[15px] leading-[1.75] [&_.is-editor-empty:first-child::before]:text-[15px] [&_.is-editor-empty:first-child::before]:leading-[1.75] [&_blockquote]:my-4 [&_blockquote]:pl-4 [&_img]:my-4 [&_img]:max-h-64 [&_img]:rounded-xl [&_li]:my-1 [&_ol]:my-4 [&_p+p]:mt-3 [&_ul]:my-4":
              density === "comfortable",
          },
        ),
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

  return <ComposeEditorContext value={contextValue}>{children}</ComposeEditorContext>;
};

export const ComposeEditorBody = ({ className }: { className?: string }) => {
  const { density, disabled, editor, recording, transcribing } = useComposeEditor();
  const audioActive = recording || transcribing;

  return (
    <div
      className={cn("min-h-0 overflow-y-auto", className, {
        "pointer-events-none opacity-80": disabled,
      })}
    >
      {audioActive ? (
        <output
          aria-label={recording ? "Recording audio" : "Transcribing audio"}
          className={cn("flex items-center justify-center", {
            "min-h-28": density === "compact",
            "min-h-72": density === "comfortable",
          })}
        >
          <div className="flex h-10 items-center gap-1.5 rounded-full border border-border bg-secondary/35 px-4">
            {audioWaveBars.map((bar, index) => (
              <span
                className={cn("h-6 w-1 animate-pulse rounded-full bg-foreground/75", {
                  "bg-primary": recording,
                  "bg-muted-foreground": transcribing,
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
        <EditorContent editor={editor} />
      ) : (
        <div
          aria-hidden
          className={cn("text-muted-foreground/75", {
            "min-h-28 text-sm/relaxed": density === "compact",
            "min-h-72 text-[15px] leading-[1.75]": density === "comfortable",
          })}
        >
          Write your message…
        </div>
      )}
    </div>
  );
};

export const ComposeEditorToolbar = ({ className }: { className?: string }) => {
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
  const toolbarActions = [
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
    {
      id: "undo",
      label: "Undo",
      icon: ArrowTurnBackwardIcon,
      disabled: !toolbarState?.canUndo,
      onClick: () => editor?.chain().focus().undo().run(),
    },
    {
      id: "redo",
      label: "Redo",
      icon: ArrowTurnForwardIcon,
      disabled: !toolbarState?.canRedo,
      onClick: () => editor?.chain().focus().redo().run(),
    },
  ];

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
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
      <Button
        aria-label="Stop recording"
        className="text-primary"
        disabled={disabled}
        onClick={onRecordingStop}
        onMouseDown={(event) => event.preventDefault()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon className="size-4" icon={StopIcon} />
      </Button>
    </IconButtonTooltip>
  ) : (
    <IconButtonTooltip label={recordingSupported ? "Dictate" : "Recording unavailable"}>
      <Button
        aria-label={recordingSupported ? "Dictate" : "Recording unavailable"}
        disabled={disabled || transcribing || !recordingSupported}
        onClick={onRecordingStart}
        onMouseDown={(event) => event.preventDefault()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon className="size-4" icon={AiMicIcon} />
      </Button>
    </IconButtonTooltip>
  );
};
