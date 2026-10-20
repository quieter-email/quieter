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
  markdown: string;
};

export const MarkdownContent = ({ markdown }: MarkdownContentProps) => (
  <div className="typeset typeset-docs max-w-[37em]">
    <Remark rehypeReactOptions={{ components: { a: markdownLink } }}>
      {markdown}
    </Remark>
  </div>
);
