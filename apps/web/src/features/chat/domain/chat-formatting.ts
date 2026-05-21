type TextBlock =
  | { content: string; type: "code" }
  | { items: string[]; type: "list" }
  | { content: string; type: "paragraph" };

export const parseTextBlocks = (text: string): TextBlock[] => {
  const lines = text.split(/\r?\n/);
  const blocks: TextBlock[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor]?.trimEnd() ?? "";
    if (!line.trim()) {
      cursor += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      cursor += 1;
      const codeLines: string[] = [];
      while (cursor < lines.length && !(lines[cursor] ?? "").trimStart().startsWith("```")) {
        codeLines.push(lines[cursor] ?? "");
        cursor += 1;
      }
      cursor += 1;
      blocks.push({ content: codeLines.join("\n"), type: "code" });
      continue;
    }

    if (/^[-*]\s+/.test(line.trimStart())) {
      const items: string[] = [];
      while (cursor < lines.length && /^[-*]\s+/.test((lines[cursor] ?? "").trimStart())) {
        items.push((lines[cursor] ?? "").trimStart().replace(/^[-*]\s+/, ""));
        cursor += 1;
      }
      blocks.push({ items, type: "list" });
      continue;
    }

    const paragraphLines = [line.trim()];
    cursor += 1;
    while (
      cursor < lines.length &&
      (lines[cursor] ?? "").trim() &&
      !/^[-*]\s+/.test((lines[cursor] ?? "").trimStart()) &&
      !(lines[cursor] ?? "").trimStart().startsWith("```")
    ) {
      paragraphLines.push((lines[cursor] ?? "").trim());
      cursor += 1;
    }
    blocks.push({ content: paragraphLines.join(" "), type: "paragraph" });
  }

  return blocks;
};

export const formatMessageDate = (value: string) => {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(date);
};
