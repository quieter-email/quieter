import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

export type SnippetContextValues = Partial<
  Record<
    "sender.name" | "sender.email" | "recipient.name" | "recipient.email",
    string
  >
>;

type SnippetMarker = {
  end: number;
  key: string;
  kind: "context" | "field";
  start: number;
};

type MarkerState =
  | { kind: "text" }
  | { kind: "first-brace" | "second-brace"; start: number }
  | {
      key: string;
      kind: "key" | "closing-brace";
      markerKind: SnippetMarker["kind"];
      start: number;
    };

type HtmlScanFrame =
  | { kind: "boundary" }
  | { kind: "node"; node: DefaultTreeAdapterMap["childNode"] };

const createMarkerScanner = (onMarker: (marker: SnippetMarker) => void) => {
  let state: MarkerState = { kind: "text" };
  let escaped = false;
  let position = 0;

  return {
    boundary() {
      state = { kind: "text" };
      escaped = false;
    },
    write(source: string): void {
      for (const character of source) {
        const start = position;
        position += character.length;

        switch (state.kind) {
          case "first-brace": {
            if (character === "{") {
              state = { kind: "second-brace", start: state.start };
              continue;
            }
            break;
          }
          case "second-brace": {
            if (character === "@" || character === "?") {
              state = {
                key: "",
                kind: "key",
                markerKind: character === "@" ? "context" : "field",
                start: state.start,
              };
              continue;
            }
            if (character === "{") {
              state = { kind: "second-brace", start: start - 1 };
              continue;
            }
            break;
          }
          case "key": {
            if (
              state.key.length < 64 &&
              (state.key.length === 0
                ? /^[A-Za-z]$/u.test(character)
                : /^[A-Za-z0-9_.-]$/u.test(character))
            ) {
              state = { ...state, key: `${state.key}${character}` };
              continue;
            }
            if (state.key.length > 0 && character === "}") {
              state = { ...state, kind: "closing-brace" };
              continue;
            }
            break;
          }
          case "closing-brace": {
            if (character === "}") {
              onMarker({
                end: position,
                key: state.key,
                kind: state.markerKind,
                start: state.start,
              });
              state = { kind: "text" };
              continue;
            }
            break;
          }
          case "text": {
            break;
          }
          default: {
            state satisfies never;
          }
        }

        state =
          character === "{" && !escaped
            ? { kind: "first-brace", start }
            : { kind: "text" };
        escaped = character === "\\" && !escaped;
      }
    },
  };
};

export const resolveSnippetVariables = (
  source: string,
  context: SnippetContextValues,
  values: Readonly<Record<string, string>> = {}
): { text: string; fields: string[] } => {
  const fields = new Set<string>();
  const parts: string[] = [];
  let cursor = 0;
  const scanner = createMarkerScanner((marker) => {
    const { key } = marker;
    const contextValue =
      marker.kind === "context" &&
      (key === "sender.name" ||
        key === "sender.email" ||
        key === "recipient.name" ||
        key === "recipient.email")
        ? context[key]
        : undefined;
    const suppliedValue = Object.hasOwn(values, key) ? values[key] : undefined;
    const replacement = contextValue?.trim() ? contextValue : suppliedValue;
    parts.push(source.slice(cursor, marker.start));
    if (replacement?.trim()) {
      parts.push(replacement);
    } else {
      fields.add(key);
      parts.push(`{{?${key}}}`);
    }
    cursor = marker.end;
  });
  scanner.write(source);
  parts.push(source.slice(cursor));

  return { fields: [...fields], text: parts.join("") };
};

const blockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "center",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const hiddenTags = new Set([
  "script",
  "style",
  "title",
  "noframes",
  "template",
]);

export const getUnresolvedSnippetFields = (input: {
  bodyHtml?: string;
  bodyText?: string;
}): string[] => {
  const fields = new Set<string>();
  const scanner = createMarkerScanner(({ key }) => {
    fields.add(key);
  });
  scanner.write(input.bodyText ?? "");
  scanner.boundary();

  const source = input.bodyHtml;
  if (source === undefined) {
    return [...fields];
  }

  const stack: HtmlScanFrame[] = parseFragment(source, {
    scriptingEnabled: false,
  }).childNodes.map((node) => ({
    kind: "node",
    node,
  }));
  stack.reverse();
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (frame.kind === "boundary") {
      scanner.boundary();
      continue;
    }

    const { node } = frame;
    if ("value" in node) {
      scanner.write(node.value);
    } else if ("tagName" in node && !hiddenTags.has(node.tagName)) {
      if (blockTags.has(node.tagName)) {
        scanner.boundary();
        stack.push({ kind: "boundary" });
      }
      for (const child of node.childNodes.toReversed()) {
        stack.push({ kind: "node", node: child });
      }
    }
  }

  return [...fields];
};
