"use client";

import {
  AiMicIcon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  QuoteUpIcon,
  NoteIcon,
  StopIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { buildComposeCommands } from "@quieter/app/features/compose/domain/compose-commands";
import { normalizeComposeBodyHtml } from "@quieter/app/features/compose/domain/draft";
import { SlashCommands } from "@quieter/app/features/compose/domain/slash-commands";
import type { VisualEmailDocument } from "@quieter/mail/visual-email";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogCloseButton,
} from "@quieter/ui/dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@quieter/ui/toolbar";
import {
  createNodeFromContent,
  Extension,
  getHTMLFromFragment,
} from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { FileHandler } from "@tiptap/extension-file-handler";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Underline } from "@tiptap/extension-underline";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { StarterKit } from "@tiptap/starter-kit";
import {
  createContext,
  use,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, Ref } from "react";

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

const ComposeQuote = Extension.create({
  addGlobalAttributes() {
    return [
      {
        attributes: {
          "data-compose-quote": { default: null },
        },
        types: ["paragraph", "blockquote"],
      },
    ];
  },
  name: "composeQuote",
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

const EMPTY_SNIPPETS: NonNullable<ComposeEditorProps["snippets"]> = [];

type ComposeEditorProps = {
  children: ReactNode;
  html: string;
  document?: VisualEmailDocument | null;
  density?: "comfortable" | "compact";
  disabled?: boolean;
  onChange: (payload: { html: string; text: string }) => void;
  onBlur?: () => void;
  onInlineImageFiles: (files: File[]) => void | Promise<void>;
  snippets?: { id: string; name: string; bodyText: string }[];
  snippetStatus?: string;
  onCreateSnippet?: (text: string) => void;
  onManageSnippets?: () => void;
  onSlashMenuOpenChange?: (open: boolean) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  recording?: boolean;
  recordingSupported?: boolean;
  transcribing?: boolean;
  ref?: Ref<ComposeEditorHandle>;
};

export type ComposeEditorHandle = {
  getDocument: () => unknown;
  normalizeHtml: (html: string) => string;
  getTextFromHtml: (html: string) => string;
  insertHtml: (html: string) => void;
};

type ComposeEditorContextValue = {
  density: NonNullable<ComposeEditorProps["density"]>;
  disabled: boolean;
  editor: Editor | null;
  onCreateSnippet?: (text: string) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  recording: boolean;
  recordingSupported: boolean;
  transcribing: boolean;
};

const ComposeEditorContext = createContext<ComposeEditorContextValue | null>(
  null
);

const useComposeEditor = () => {
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
  document,
  html,
  onBlur,
  onChange,
  onInlineImageFiles,
  snippets = EMPTY_SNIPPETS,
  snippetStatus,
  onCreateSnippet,
  onManageSnippets,
  onSlashMenuOpenChange,
  onRecordingStart,
  onRecordingStop,
  recording = false,
  recordingSupported = false,
  transcribing = false,
  ref,
}: ComposeEditorProps) => {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [linkRange, setLinkRange] = useState<Range | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const commandOptions = useRef({
    onCreateSnippet,
    onManageSnippets,
    onSlashMenuOpenChange,
    snippetStatus,
    snippets,
  });
  useEffect(() => {
    commandOptions.current = {
      onCreateSnippet,
      onManageSnippets,
      onSlashMenuOpenChange,
      snippetStatus,
      snippets,
    };
  }, [
    snippets,
    snippetStatus,
    onCreateSnippet,
    onManageSnippets,
    onSlashMenuOpenChange,
  ]);
  const editor = useEditor({
    autofocus: false,
    content: document?.content ?? html.trim(),
    editable: disabled !== true,
    editorProps: {
      attributes: {
        class:
          "min-h-full bg-transparent text-body text-fg outline-none [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-fg [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_a]:text-fg [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-fg [&_img]:my-3 [&_img]:max-h-48 [&_img]:max-w-full [&_img]:rounded-md [&_img]:object-contain [&_li]:my-0.5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_p+p]:mt-2 [&_s]:text-muted-fg [&_strong]:font-semibold [&_u]:underline [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
      },
    },
    extensions: [
      ComposeQuote,
      StarterKit.configure({
        heading: false,
        link: false,
        underline: false,
      }),
      // oxlint-disable-next-line react/refs -- Tiptap invokes suggestion callbacks after render, when command options and input refs are current.
      SlashCommands.configure({
        getItems: (query, currentEditor) =>
          buildComposeCommands({
            editor: currentEditor,
            onCreateSnippet: commandOptions.current.onCreateSnippet,
            onInsertImage: () => imageInputRef.current?.click(),
            onInsertLink: (range) => {
              setLinkUrl("");
              setLinkRange(range);
            },
            onManageSnippets: commandOptions.current.onManageSnippets,
            query,
            snippets: commandOptions.current.snippets,
          }),
        getStatus: () => commandOptions.current.snippetStatus,
        onOpenChange: (open) =>
          commandOptions.current.onSlashMenuOpenChange?.(open),
      }),
      Underline,
      Link.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: true,
      }),
      Placeholder.configure({
        placeholder: "Write your message, or type / for commands…",
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
    onUpdate: ({ editor: updatedEditor }) => {
      onChange({
        html: updatedEditor.getHTML(),
        text: updatedEditor.getText({ blockSeparator: "\n\n" }),
      });
    },
  });

  useImperativeHandle(ref, () => ({
    getDocument: () =>
      editor ? { content: editor.getJSON(), version: 1 } : null,
    getTextFromHtml: (value) => {
      if (!editor) {
        return (
          new DOMParser().parseFromString(value, "text/html").body
            .textContent ?? ""
        );
      }
      const content = createNodeFromContent(value, editor.schema, {
        slice: false,
      });
      const size = "type" in content ? content.content.size : content.size;
      return content.textBetween(0, size, "\n\n");
    },
    insertHtml: (nextHtml) => {
      editor?.chain().focus().insertContent(nextHtml).run();
    },
    normalizeHtml: (value) => {
      if (!editor) {
        return value;
      }
      const content = createNodeFromContent(value, editor.schema);
      return getHTMLFromFragment(
        "type" in content ? content.content : content,
        editor.schema
      );
    },
  }));

  // Tiptap's useEditor with default deps merges options but preserves `editable`; toggling
  // `disabled` must call setEditable so the instance matches without recreating the editor.
  useEffect(() => {
    if (!editor) {
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    editor.setEditable(disabled !== true, false);
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
    editor.commands.setContent(document?.content ?? (next || "<p></p>"), {
      emitUpdate: false,
    });
  }, [document, editor, html]);

  const contextValue = useMemo(
    () => ({
      density,
      disabled: disabled === true,
      editor,
      onCreateSnippet,
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
      onCreateSnippet,
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
      {editor && disabled !== true && !recording && !transcribing ? (
        <BubbleMenu
          editor={editor}
          appendTo={() => window.document.body}
          className="z-50"
          options={{ offset: 6, placement: "top", shift: { padding: 8 } }}
          updateDelay={0}
        >
          {/* oxlint-disable-next-line no-use-before-define -- The toolbar renders after module initialization. */}
          <ComposeEditorToolbar chrome="selection" />
        </BubbleMenu>
      ) : null}
      <input
        accept="image/*"
        aria-label="Insert image"
        className="hidden"
        multiple
        onChange={(event) => {
          void onInlineImageFiles([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
        ref={imageInputRef}
        type="file"
      />
      <Dialog
        open={linkRange !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLinkRange(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert a link</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <label
              className="space-y-2 text-caption"
              htmlFor="compose-link-url"
            >
              Address
              <Input
                id="compose-link-url"
                onChange={(event) => {
                  setLinkUrl(event.currentTarget.value);
                }}
                placeholder="https://example.com"
                value={linkUrl}
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
            <Button
              disabled={!linkUrl.trim()}
              onClick={() => {
                try {
                  const { href } = new URL(linkUrl.trim());
                  if (
                    !["https:", "http:", "mailto:"].includes(
                      new URL(href).protocol
                    )
                  ) {
                    toast.error("Use a web or email address for links.");
                    return;
                  }
                  if (editor && linkRange) {
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(linkRange, {
                        marks: [{ attrs: { href }, type: "link" }],
                        text: href,
                        type: "text",
                      })
                      .run();
                    setLinkRange(null);
                  }
                } catch {
                  toast.error("Use a web or email address for links.");
                }
              }}
              type="button"
            >
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ComposeEditorContext>
  );
};

export const ComposeEditorBody = ({
  chrome = "default",
  className,
  invalid = false,
}: {
  /**
   * `seamless` drops the card and its focus ring so the body can sit inside the
   * composer sheet as one continuous surface.
   */
  chrome?: "default" | "seamless";
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
                // oxlint-disable-next-line shadcn/no-inline-styles -- Bar delay and scale are computed per sample.
                animationDelay: `${index * 70}ms`,
                // oxlint-disable-next-line shadcn/no-inline-styles -- Bar delay and scale are computed per sample.
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
        "relative min-h-20 w-full overflow-hidden rounded-md border border-border bg-control text-body text-fg shadow-sm transition-colors duration-150 ease-out squircle",
        {
          "has-[.ProseMirror:focus-visible]:border-ring has-[.ProseMirror:focus-visible]:ring-1 has-[.ProseMirror:focus-visible]:ring-ring/45 has-[.ProseMirror:focus-visible]:outline-none aria-invalid:border-destructive aria-invalid:focus-within:border-destructive aria-invalid:focus-within:ring-destructive/45":
            chrome === "default",
          "rounded-none border-0 bg-transparent shadow-none":
            chrome === "seamless",
        },
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
  chrome = "default",
  className,
  leading,
  trailing,
}: {
  /** `footer` seats the toolbar as the composer sheet's own band, not a floating bar. */
  chrome?: "default" | "footer" | "selection";
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) => {
  const { disabled, editor, onCreateSnippet } = useComposeEditor();
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
      canStrike:
        currentEditor?.can().chain().focus().toggleStrike().run() === true,
      canUnderline:
        currentEditor?.can().chain().focus().toggleUnderline().run() === true,
      canUndo: currentEditor?.can().chain().focus().undo().run() === true,
      italicActive: currentEditor?.isActive("italic") === true,
      orderedListActive: currentEditor?.isActive("orderedList") === true,
      selectedText: currentEditor
        ? currentEditor.state.doc.textBetween(
            currentEditor.state.selection.from,
            currentEditor.state.selection.to,
            "\n"
          )
        : "",
      strikeActive: currentEditor?.isActive("strike") === true,
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
      active: toolbarState?.strikeActive === true,
      disabled: toolbarState?.canStrike !== true,
      icon: TextStrikethroughIcon,
      id: "strike",
      label: "Strikethrough",
      onClick: () => editor?.chain().focus().toggleStrike().run(),
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

  const formattingControls = (
    <ToolbarGroup>
      {formatActions
        .filter(
          (action) =>
            chrome !== "selection" ||
            ["bold", "italic", "underline", "bullet-list"].includes(action.id)
        )
        .map((action) => (
          <IconButtonTooltip key={action.id} label={action.label}>
            <ToolbarButton
              aria-label={action.label}
              aria-pressed={action.active}
              disabled={disabled || action.disabled}
              onClick={() => {
                action.onClick();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              size={chrome === "selection" ? "icon-sm" : "icon"}
              type="button"
              variant={action.active ? "selected" : undefined}
            >
              <HugeiconsIcon className="size-4" icon={action.icon} />
            </ToolbarButton>
          </IconButtonTooltip>
        ))}
    </ToolbarGroup>
  );

  const historyControls = (
    <ToolbarGroup>
      <IconButtonTooltip label="Undo">
        <ToolbarButton
          aria-label="Undo"
          disabled={disabled || toolbarState?.canUndo !== true}
          onClick={() => {
            editor?.chain().focus().undo().run();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          size="icon"
          type="button"
        >
          <HugeiconsIcon className="size-4" icon={ArrowTurnBackwardIcon} />
        </ToolbarButton>
      </IconButtonTooltip>
      <IconButtonTooltip label="Redo">
        <ToolbarButton
          aria-label="Redo"
          disabled={disabled || toolbarState?.canRedo !== true}
          onClick={() => {
            editor?.chain().focus().redo().run();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          size="icon"
          type="button"
        >
          <HugeiconsIcon className="size-4" icon={ArrowTurnForwardIcon} />
        </ToolbarButton>
      </IconButtonTooltip>
    </ToolbarGroup>
  );

  return (
    <Toolbar
      size={chrome === "selection" ? "compact" : "default"}
      className={cn(
        // oxlint-disable-next-line shadcn/no-restyle -- Composer bar keeps its control-surface metrics.
        "min-w-0 shrink-0 rounded-md border-border bg-control",
        {
          // oxlint-disable-next-line shadcn/no-restyle -- Composer footer keeps its attached-bar metrics.
          "min-h-12 gap-1.5 rounded-none border-0 border-t border-border bg-control px-3 py-2 shadow-none @max-2xl:flex-wrap":
            chrome === "footer",
          "w-full": chrome !== "selection",
        },
        className
      )}
    >
      {leading === undefined ? null : (
        <div className="flex shrink-0 items-center">{leading}</div>
      )}
      <div
        className={cn({
          contents: chrome !== "footer",
          "flex min-w-0 shrink-0 items-center gap-1 @max-2xl:order-last @max-2xl:w-full @max-2xl:overflow-x-auto [&>*]:shrink-0":
            chrome === "footer",
        })}
      >
        {formattingControls}
        {chrome === "selection" ? null : <ToolbarSeparator />}
        {chrome === "selection" ? null : historyControls}
        {onCreateSnippet && toolbarState?.selectedText.trim() ? (
          <IconButtonTooltip label="Save selected text as a snippet">
            <ToolbarButton
              aria-label="Save selected text as a snippet"
              disabled={disabled}
              size={chrome === "selection" ? "icon-sm" : "default"}
              onClick={() => {
                onCreateSnippet(toolbarState.selectedText);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              type="button"
            >
              <HugeiconsIcon icon={NoteIcon} />
              {chrome === "selection" ? null : "Save snippet"}
            </ToolbarButton>
          </IconButtonTooltip>
        ) : null}
      </div>
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
        // oxlint-disable-next-line shadcn/no-restyle -- Recording stop keeps its primary tint.
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
        disabled={disabled || transcribing || !recordingSupported}
        onClick={onRecordingStart}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        size="icon"
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={AiMicIcon} />
      </ToolbarButton>
    </IconButtonTooltip>
  );
};
