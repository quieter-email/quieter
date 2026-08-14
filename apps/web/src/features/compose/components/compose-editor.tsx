"use client";

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
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@quieter/ui/toolbar";
import type { Editor } from "@tiptap/core";
import { FileHandler } from "@tiptap/extension-file-handler";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Underline } from "@tiptap/extension-underline";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  createContext,
  use,
  useEffect,
  useImperativeHandle,
  useMemo,
} from "react";
import type { ReactNode, Ref } from "react";

import { normalizeComposeBodyHtml } from "../domain/draft";
import {
  createTemplatePlaceholderToken,
  getSelectedTemplatePlaceholder,
  hydrateTemplatePlaceholders,
  TemplatePlaceholder,
} from "../domain/template-placeholders";
import type { TemplatePlaceholderRange } from "../domain/template-placeholders";

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
  onPlaceholderSelectionChange?: (
    placeholder: TemplatePlaceholderRange | null
  ) => void;
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

const ComposeEditorContext = createContext<ComposeEditorContextValue | null>(
  null
);

export const useComposeEditor = () => {
  const value = use(ComposeEditorContext);
  if (!value) {
    throw new Error("Compose editor components must be inside ComposeEditor.");
  }
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
    editable: disabled !== true,
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
        autolink: true,
        defaultProtocol: "https",
        openOnClick: true,
      }),
      Placeholder.configure({
        placeholder: "Write your message…",
      }),
      ComposeImage.configure({
        allowBase64: true,
        inline: false,
      }),
      FileHandler.configure({
        onDrop: (_editor, files) => {
          const imageFiles = files.filter((file) =>
            file.type.startsWith("image/")
          );
          void onInlineImageFiles(imageFiles);
        },
        onPaste: (_editor, files) => {
          const imageFiles = files.filter((file) =>
            file.type.startsWith("image/")
          );
          void onInlineImageFiles(imageFiles);
        },
      }),
    ],
    immediatelyRender: false,
    onBlur: () => onBlur?.(),
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      onPlaceholderSelectionChange?.(
        getSelectedTemplatePlaceholder(updatedEditor)
      );
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
      if (!editor || !token) {
        return;
      }

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
      if (!editor) {
        return false;
      }
      const placeholder = getSelectedTemplatePlaceholder(editor);
      if (!placeholder) {
        return false;
      }

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
    if (!editor) {
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    editor.setEditable(disabled !== true);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    const current = normalizeComposeBodyHtml(editor.getHTML());
    const next = normalizeComposeBodyHtml(html);

    if (current === next) {
      return;
    }
    editor.commands.setContent(hydrateTemplatePlaceholders(next) || "<p></p>", {
      emitUpdate: false,
    });
  }, [editor, html]);

  const contextValue = useMemo(
    () => ({
      density,
      disabled: disabled === true,
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
    ]
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
  const { density, disabled, editor, recording, transcribing } =
    useComposeEditor();
  const audioActive = recording || transcribing;
  let editorBody: ReactNode;

  if (audioActive) {
    editorBody = (
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
                "bg-muted-fg": transcribing,
                "bg-primary": recording,
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
    );
  } else if (editor) {
    editorBody = (
      <EditorContent
        className="absolute inset-0 overflow-y-auto px-4 py-3.5 [&>.ProseMirror]:min-h-full"
        editor={editor}
      />
    );
  } else {
    editorBody = (
      <div
        aria-hidden
        className={cn("h-full px-4 py-3.5 text-muted-fg", {
          "min-h-28": density === "compact",
          "min-h-48": density === "comfortable",
        })}
      >
        Write your message…
      </div>
    );
  }

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
        }
      )}
    >
      {editorBody}
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
      blockquoteActive: currentEditor?.isActive("blockquote") === true,
      boldActive: currentEditor?.isActive("bold") === true,
      bulletListActive: currentEditor?.isActive("bulletList") === true,
      canBlockquote:
        currentEditor?.can().chain().focus().toggleBlockquote().run() === true,
      canBold: currentEditor?.can().chain().focus().toggleBold().run() === true,
      canBulletList:
        currentEditor?.can().chain().focus().toggleBulletList().run() === true,
      canItalic:
        currentEditor?.can().chain().focus().toggleItalic().run() === true,
      canOrderedList:
        currentEditor?.can().chain().focus().toggleOrderedList().run() === true,
      canRedo: currentEditor?.can().chain().focus().redo().run() === true,
      canUnderline:
        currentEditor?.can().chain().focus().toggleUnderline().run() === true,
      canUndo: currentEditor?.can().chain().focus().undo().run() === true,
      italicActive: currentEditor?.isActive("italic") === true,
      orderedListActive: currentEditor?.isActive("orderedList") === true,
      underlineActive: currentEditor?.isActive("underline") === true,
    }),
  });

  const formatActions = [
    {
      active: toolbarState?.boldActive === true,
      disabled: toolbarState?.canBold !== true,
      icon: TextBoldIcon,
      id: "bold",
      label: "Bold",
      onClick: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      active: toolbarState?.italicActive === true,
      disabled: toolbarState?.canItalic !== true,
      icon: TextItalicIcon,
      id: "italic",
      label: "Italic",
      onClick: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      active: toolbarState?.underlineActive === true,
      disabled: toolbarState?.canUnderline !== true,
      icon: TextUnderlineIcon,
      id: "underline",
      label: "Underline",
      onClick: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      active: toolbarState?.bulletListActive === true,
      disabled: toolbarState?.canBulletList !== true,
      icon: LeftToRightListBulletIcon,
      id: "bullet-list",
      label: "Bullet list",
      onClick: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      active: toolbarState?.orderedListActive === true,
      disabled: toolbarState?.canOrderedList !== true,
      icon: LeftToRightListNumberIcon,
      id: "ordered-list",
      label: "Ordered list",
      onClick: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      active: toolbarState?.blockquoteActive === true,
      disabled: toolbarState?.canBlockquote !== true,
      icon: QuoteUpIcon,
      id: "quote",
      label: "Quote",
      onClick: () => editor?.chain().focus().toggleBlockquote().run(),
    },
  ] as const;

  return (
    <Toolbar
      className={cn(
        "w-full min-w-0 shrink-0 rounded-md border-border bg-bg-elevated",
        className
      )}
    >
      <ToolbarGroup>
        {formatActions.map((action) => (
          <IconButtonTooltip key={action.id} label={action.label}>
            <ToolbarButton
              aria-label={action.label}
              aria-pressed={action.active}
              className={cn("size-8 px-0", {
                "bg-bg-surface text-fg shadow-sm": action.active,
              })}
              disabled={disabled || action.disabled}
              onClick={() => {
                action.onClick();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
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
            disabled={disabled || toolbarState?.canUndo !== true}
            onClick={() => {
              editor?.chain().focus().undo().run();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <HugeiconsIcon className="size-4" icon={ArrowTurnBackwardIcon} />
          </ToolbarButton>
        </IconButtonTooltip>
        <IconButtonTooltip label="Redo">
          <ToolbarButton
            aria-label="Redo"
            className="size-8 px-0"
            disabled={disabled || toolbarState?.canRedo !== true}
            onClick={() => {
              editor?.chain().focus().redo().run();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <HugeiconsIcon className="size-4" icon={ArrowTurnForwardIcon} />
          </ToolbarButton>
        </IconButtonTooltip>
      </ToolbarGroup>
      {trailing === undefined ? null : (
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {trailing}
        </div>
      )}
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
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={StopIcon} />
        Stop
      </ToolbarButton>
    </IconButtonTooltip>
  ) : (
    <IconButtonTooltip
      label={recordingSupported ? "Dictate" : "Recording unavailable"}
    >
      <ToolbarButton
        aria-label={recordingSupported ? "Dictate" : "Recording unavailable"}
        className="size-8 px-0"
        disabled={disabled || transcribing || !recordingSupported}
        onClick={onRecordingStart}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={AiMicIcon} />
      </ToolbarButton>
    </IconButtonTooltip>
  );
};
