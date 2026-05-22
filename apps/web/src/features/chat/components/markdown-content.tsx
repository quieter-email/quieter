"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@quieter/ui";
import { Remark } from "react-remark";

const markdownLink = ({ className, href, ...props }: ComponentPropsWithoutRef<"a">) => (
  <a
    className={cn(
      "text-primary underline decoration-border underline-offset-2 hover:decoration-current",
      className,
    )}
    href={href}
    rel="noopener noreferrer"
    target="_blank"
    {...props}
  />
);

type MarkdownContentProps = {
  className?: string;
  markdown: string;
};

export const MarkdownContent = ({ className, markdown }: MarkdownContentProps) => (
  <div
    className={cn(
      "prose max-w-none prose-a:text-primary prose-a:underline prose-a:decoration-border prose-a:underline-offset-2 prose-a:hover:decoration-current",
      className,
    )}
  >
    <Remark rehypeReactOptions={{ components: { a: markdownLink } }}>{markdown}</Remark>
  </div>
);
