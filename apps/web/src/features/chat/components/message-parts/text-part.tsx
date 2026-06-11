"use client";

import { MarkdownContent } from "../markdown-content";

export const TextPart = ({ isStreaming, text }: { isStreaming?: boolean; text: string }) => (
  <MarkdownContent isStreaming={isStreaming} markdown={text} />
);
