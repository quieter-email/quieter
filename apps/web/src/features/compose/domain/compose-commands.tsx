import {
  CodeIcon,
  Image01Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  NoteIcon,
  QuoteUpIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Editor, Range } from "@tiptap/core";

import type { SlashCommand } from "./slash-commands";

type ComposeCommandOptions = {
  query: string;
  editor: Editor;
  snippets: readonly { id: string; name: string; bodyText: string }[];
  onInsertLink: (range: Range) => void;
  onInsertImage: () => void;
  onCreateSnippet?: (text: string) => void;
  onManageSnippets?: () => void;
};

export const buildComposeCommands = ({
  query,
  editor,
  snippets,
  onInsertLink,
  onInsertImage,
  onCreateSnippet,
  onManageSnippets,
}: ComposeCommandOptions): SlashCommand[] => {
  const formatCommands = [
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.setParagraph(),
      icon: NoteIcon,
      id: "text",
      keywords: "paragraph normal",
      label: "Plain text",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleBold(),
      icon: TextBoldIcon,
      id: "bold",
      keywords: "strong",
      label: "Bold",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleItalic(),
      icon: TextItalicIcon,
      id: "italic",
      keywords: "emphasis",
      label: "Italic",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleUnderline(),
      icon: TextUnderlineIcon,
      id: "underline",
      keywords: "",
      label: "Underline",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleStrike(),
      icon: TextStrikethroughIcon,
      id: "strike",
      keywords: "strike crossed",
      label: "Strikethrough",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleBulletList(),
      icon: LeftToRightListBulletIcon,
      id: "bullet-list",
      keywords: "unordered bullets",
      label: "Bullet list",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleOrderedList(),
      icon: LeftToRightListNumberIcon,
      id: "ordered-list",
      keywords: "ordered numbers",
      label: "Numbered list",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleBlockquote(),
      icon: QuoteUpIcon,
      id: "quote",
      keywords: "blockquote",
      label: "Quote",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleCode(),
      icon: CodeIcon,
      id: "code",
      keywords: "monospace",
      label: "Inline code",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.toggleCodeBlock(),
      icon: CodeIcon,
      id: "code-block",
      keywords: "monospace",
      label: "Code block",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.setHorizontalRule(),
      icon: NoteIcon,
      id: "divider",
      keywords: "horizontal rule separator",
      label: "Divider",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) => chain.setHardBreak(),
      icon: NoteIcon,
      id: "line-break",
      keywords: "newline",
      label: "Line break",
    },
    {
      apply: (chain: ReturnType<Editor["chain"]>) =>
        chain.unsetAllMarks().clearNodes(),
      icon: NoteIcon,
      id: "clear",
      keywords: "reset remove",
      label: "Clear formatting",
    },
  ];
  const commands: (SlashCommand & { keywords?: string })[] = formatCommands
    .filter((action) => action.apply(editor.can().chain()).run())
    .map((action) => ({
      group: "Formatting",
      icon: <HugeiconsIcon icon={action.icon} />,
      id: action.id,
      keywords: action.keywords,
      label: action.label,
      run: (targetEditor, range) => {
        action.apply(targetEditor.chain().focus().deleteRange(range)).run();
      },
    }));
  commands.push(
    {
      group: "Insert",
      icon: <HugeiconsIcon icon={NoteIcon} />,
      id: "link",
      label: "Link",
      run: (targetEditor, range) => {
        targetEditor.chain().focus().deleteRange(range).run();
        onInsertLink({ from: range.from, to: range.from });
      },
    },
    {
      group: "Insert",
      icon: <HugeiconsIcon icon={Image01Icon} />,
      id: "image",
      label: "Image",
      run: (targetEditor, range) => {
        targetEditor.chain().focus().deleteRange(range).run();
        onInsertImage();
      },
    },
    ...snippets.map((snippet) => ({
      description: snippet.bodyText,
      group: "Snippets",
      icon: <HugeiconsIcon icon={NoteIcon} />,
      id: `snippet-${snippet.id}`,
      label: snippet.name,
      run: (targetEditor: Editor, range: Range) => {
        targetEditor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(
            snippet.bodyText
              .replaceAll(/\r\n?/gu, "\n")
              .split("\n")
              .flatMap((line, index) => [
                ...(index === 0 ? [] : [{ type: "hardBreak" }]),
                ...(line.length === 0 ? [] : [{ text: line, type: "text" }]),
              ])
          )
          .run();
      },
    }))
  );
  if (onCreateSnippet) {
    commands.push({
      group: "Snippets",
      icon: <HugeiconsIcon icon={NoteIcon} />,
      id: "new-snippet",
      keywords: "create save",
      label: "New snippet",
      run: (targetEditor, range) => {
        targetEditor.chain().focus().deleteRange(range).run();
        onCreateSnippet("");
      },
    });
  }
  if (onManageSnippets) {
    commands.push({
      group: "Snippets",
      icon: <HugeiconsIcon icon={NoteIcon} />,
      id: "manage-snippets",
      label: "Manage snippets",
      run: (targetEditor, range) => {
        targetEditor.chain().focus().deleteRange(range).run();
        onManageSnippets();
      },
    });
  }
  const search = query.trim().toLocaleLowerCase().replaceAll(/\s+/gu, "");
  return commands.filter((command) =>
    `${command.label} ${command.keywords ?? ""}`
      .toLocaleLowerCase()
      .replaceAll(/\s+/gu, "")
      .includes(search)
  );
};
