"use client";

import { MailReference } from "@quieter/app/features/chat/components/mail-reference";
import { parseMailReference } from "@quieter/app/features/chat/domain/mail-reference";

import "katex/dist/katex.min.css";
import type { ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import type { ExtraProps } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { remarkCurrency } from "./remark-currency";

const markdownLink = ({
  children,
  href,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & ExtraProps) => {
  const reference = parseMailReference(href);
  if (reference !== null) {
    return <MailReference reference={reference}>{children}</MailReference>;
  }
  if (!href || !/^(?:https?:\/\/|mailto:)/iu.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a href={href} {...props} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
};

const markdownImage = ({ alt }: ComponentPropsWithoutRef<"img">) => (
  <span>{alt || "Image omitted"}</span>
);

type MarkdownContentProps = {
  markdown: string;
};

export const MarkdownContent = ({ markdown }: MarkdownContentProps) => (
  <div className="typeset typeset-body [&_.katex-display]:overflow-x-auto [&_.katex-display>.katex]:min-w-max">
    <Markdown
      components={{ a: markdownLink, img: markdownImage }}
      rehypePlugins={[[rehypeKatex, { maxSize: 20, trust: false }]]}
      remarkPlugins={[remarkMath, remarkCurrency]}
      skipHtml
    >
      {markdown}
    </Markdown>
  </div>
);
