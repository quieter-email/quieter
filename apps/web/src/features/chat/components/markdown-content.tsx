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

const chatProseClassName =
  "prose prose-sm max-w-none prose-neutral dark:prose-invert prose-headings:font-medium prose-headings:text-foreground prose-p:text-[13.5px] prose-p:leading-relaxed prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-hr:border-border prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground";

type MarkdownContentProps = {
  className?: string;
  markdown: string;
};

export const MarkdownContent = ({ className, markdown }: MarkdownContentProps) => (
  <div className={cn(chatProseClassName, className)}>
    <Remark rehypeReactOptions={{ components: { a: markdownLink } }}>{markdown}</Remark>
  </div>
);
