"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@quieter/ui/cn";
import { Remark } from "react-remark";

const markdownLink = ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => (
  <a href={href} {...props} rel="noopener noreferrer" target="_blank">
    {children}
  </a>
);

type MarkdownContentProps = {
  isStreaming?: boolean;
  markdown: string;
};

export const MarkdownContent = ({ isStreaming, markdown }: MarkdownContentProps) => (
  <div className={cn("typeset typeset-docs max-w-[37em]", { "streaming-cursor": isStreaming })}>
    <Remark rehypeReactOptions={{ components: { a: markdownLink } }}>{markdown}</Remark>
  </div>
);
