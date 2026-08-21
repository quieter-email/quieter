"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Remark } from "react-remark";

const markdownLink = ({
  children,
  href,
  ...props
}: ComponentPropsWithoutRef<"a">) => (
  <a href={href} {...props} rel="noopener noreferrer" target="_blank">
    {children}
  </a>
);

type MarkdownContentProps = {
  isStreaming?: boolean;
  markdown: string;
};

export const MarkdownContent = ({
  isStreaming,
  markdown,
}: MarkdownContentProps) => (
  <div
    className={`typeset typeset-docs max-w-none ${
      isStreaming === true ? "streaming-cursor" : ""
    }`}
  >
    <Remark rehypeReactOptions={{ components: { a: markdownLink } }}>
      {markdown}
    </Remark>
  </div>
);
