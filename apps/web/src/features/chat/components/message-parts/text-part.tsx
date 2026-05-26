"use client";

import { MarkdownContent } from "../markdown-content";

export const TextPart = ({ text }: { text: string }) => (
  <MarkdownContent
    className="prose-sm prose-headings:text-foreground prose-p:text-[13.5px] prose-p:leading-relaxed prose-p:text-foreground/85 prose-strong:text-foreground prose-code:text-foreground/75"
    markdown={text}
  />
);
