"use client";

import { MarkdownContent } from "../markdown-content";

export const TextPart = ({ text }: { text: string }) => (
  <MarkdownContent
    className="prose-sm prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-code:text-foreground/80"
    markdown={text}
  />
);
