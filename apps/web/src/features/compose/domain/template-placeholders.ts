import { mergeAttributes, Node } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

import { createTemplatePlaceholderToken } from "./template-placeholder-values";

export {
  createTemplatePlaceholderToken,
  hydrateTemplatePlaceholders,
  serializeTemplatePlaceholders,
  TEMPLATE_PLACEHOLDER_PATTERN,
} from "./template-placeholder-values";

export type TemplatePlaceholderRange = {
  from: number;
  label: string;
  to: number;
};

export const findTemplatePlaceholders = (
  document: Editor["state"]["doc"]
): TemplatePlaceholderRange[] => {
  const placeholders: TemplatePlaceholderRange[] = [];

  document.descendants((node, position) => {
    const label: unknown =
      node.type.name === "templatePlaceholder" ? node.attrs.label : null;
    if (typeof label !== "string" || !label.trim()) {
      return;
    }

    placeholders.push({
      from: position,
      label: label.trim(),
      to: position + node.nodeSize,
    });
  });

  return placeholders;
};

export const getSelectedTemplatePlaceholder = (
  editor: Pick<Editor, "state">
): TemplatePlaceholderRange | null => {
  const { selection } = editor.state;
  return (
    findTemplatePlaceholders(editor.state.doc).find(
      (placeholder) =>
        (selection.from === placeholder.from &&
          selection.to === placeholder.to) ||
        (selection.empty &&
          selection.from >= placeholder.from &&
          selection.from <= placeholder.to)
    ) ?? null
  );
};

const selectTemplatePlaceholder = (
  editor: Editor,
  direction: "backward" | "forward"
): boolean => {
  const placeholders = findTemplatePlaceholders(editor.state.doc);
  if (placeholders.length === 0) {
    return false;
  }

  const current = getSelectedTemplatePlaceholder(editor);
  const cursor = editor.state.selection.from;
  const target =
    direction === "forward"
      ? (placeholders.find(
          (placeholder) => placeholder.from > (current?.from ?? cursor)
        ) ?? placeholders[0])
      : (placeholders.findLast(
          (placeholder) => placeholder.from < (current?.from ?? cursor)
        ) ?? placeholders.at(-1));
  if (!target) {
    return false;
  }

  return editor
    .chain()
    .focus()
    .setNodeSelection(target.from)
    .scrollIntoView()
    .run();
};

export const TemplatePlaceholder = Node.create({
  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (element) =>
          element.dataset.quieterTemplatePlaceholder ?? "",
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Shift-Tab": () => selectTemplatePlaceholder(this.editor, "backward"),
      Tab: () => selectTemplatePlaceholder(this.editor, "forward"),
    };
  },

  atom: true,

  group: "inline",

  inline: true,

  name: "templatePlaceholder",

  parseHTML() {
    return [{ tag: "span[data-quieter-template-placeholder]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = typeof node.attrs.label === "string" ? node.attrs.label : "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "aria-label": `Placeholder: ${label}`,
        class: "quieter-template-placeholder",
        contenteditable: "false",
        "data-quieter-template-placeholder": label,
      }),
      label,
    ];
  },

  renderText({ node }) {
    return createTemplatePlaceholderToken(
      typeof node.attrs.label === "string" ? node.attrs.label : ""
    );
  },

  selectable: true,
});
