"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@quieter/ui";
import { Remark } from "react-remark";

const markdownLink = ({ children, className, href, ...props }: ComponentPropsWithoutRef<"a">) => (
  <a
    className={cn(
      "text-primary underline decoration-border underline-offset-2 hover:decoration-current",
      className,
    )}
    href={href}
    rel="noopener noreferrer"
    target="_blank"
    {...props}
  >
    {children}
  </a>
);

type MarkdownContentProps = {
  className?: string;
  isStreaming?: boolean;
  markdown: string;
};

export const MarkdownContent = ({ className, isStreaming, markdown }: MarkdownContentProps) => (
  <div
    className={cn(
      "prose prose-sm max-w-none prose-neutral dark:prose-invert prose-headings:font-medium prose-headings:text-foreground prose-p:text-[13.5px] prose-p:leading-relaxed prose-p:text-foreground/90 prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-strong:text-foreground prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-li:text-foreground/90 prose-hr:border-border",
      { "streaming-cursor": isStreaming },
      className,
    )}
  >
    <Remark rehypeReactOptions={{ components: { a: markdownLink } }}>{markdown}</Remark>
  </div>
);
