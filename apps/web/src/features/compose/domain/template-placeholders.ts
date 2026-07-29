import { mergeAttributes, Node, type Editor } from "@tiptap/core";

export type TemplatePlaceholderRange = {
  from: number;
  label: string;
  to: number;
};

export const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{quieter:([^{}\n]{1,80})\}\}/g;
const TEMPLATE_PLACEHOLDER_HTML_PATTERN =
  /<span\b[^>]*data-quieter-template-placeholder="([^"]*)"[^>]*>[^<]*<\/span>/gi;

export const createTemplatePlaceholderToken = (label: string) => {
  const normalized = label
    .replaceAll(/[{}<>&"\n\r]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return normalized ? `{{quieter:${normalized}}}` : "";
};

export const findTemplatePlaceholders = (
  document: Editor["state"]["doc"],
): TemplatePlaceholderRange[] => {
  const placeholders: TemplatePlaceholderRange[] = [];

  document.descendants((node, position) => {
    const label = node.type.name === "templatePlaceholder" ? node.attrs.label : null;
    if (typeof label !== "string" || !label.trim()) return;

    placeholders.push({
      from: position,
      label: label.trim(),
      to: position + node.nodeSize,
    });
  });

  return placeholders;
};

export const getSelectedTemplatePlaceholder = (
  editor: Pick<Editor, "state">,
): TemplatePlaceholderRange | null => {
  const { selection } = editor.state;
  return (
    findTemplatePlaceholders(editor.state.doc).find(
      (placeholder) =>
        (selection.from === placeholder.from && selection.to === placeholder.to) ||
        (selection.empty && selection.from >= placeholder.from && selection.from <= placeholder.to),
    ) ?? null
  );
};

const selectTemplatePlaceholder = (editor: Editor, direction: "backward" | "forward"): boolean => {
  const placeholders = findTemplatePlaceholders(editor.state.doc);
  if (placeholders.length === 0) return false;

  const current = getSelectedTemplatePlaceholder(editor);
  const cursor = editor.state.selection.from;
  const target =
    direction === "forward"
      ? (placeholders.find((placeholder) => placeholder.from > (current?.from ?? cursor)) ??
        placeholders[0])
      : (placeholders.findLast((placeholder) => placeholder.from < (current?.from ?? cursor)) ??
        placeholders.at(-1));
  if (!target) return false;

  return editor.chain().focus().setNodeSelection(target.from).scrollIntoView().run();
};

export const hydrateTemplatePlaceholders = (html: string) =>
  html.replaceAll(TEMPLATE_PLACEHOLDER_PATTERN, (_match, rawLabel: string) => {
    const token = createTemplatePlaceholderToken(rawLabel);
    if (!token) return "";
    const label = token.slice("{{quieter:".length, -2);
    return `<span data-quieter-template-placeholder="${label}">${label}</span>`;
  });

export const serializeTemplatePlaceholders = (html: string) =>
  html.replaceAll(TEMPLATE_PLACEHOLDER_HTML_PATTERN, (_match, label: string) =>
    createTemplatePlaceholderToken(label),
  );

export const TemplatePlaceholder = Node.create({
  name: "templatePlaceholder",

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-quieter-template-placeholder") ?? "",
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
  selectable: true,

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
      typeof node.attrs.label === "string" ? node.attrs.label : "",
    );
  },
});
