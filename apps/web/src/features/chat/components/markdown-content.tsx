"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Remark } from "react-remark";

import { parseMailReference } from "../domain/mail-reference";
import { MailReference } from "./mail-reference";

const markdownLink = ({
  children,
  href,
  ...props
}: ComponentPropsWithoutRef<"a">) => {
  const reference = parseMailReference(href);
  if (reference !== null) {
    return <MailReference reference={reference}>{children}</MailReference>;
  }
  if (href?.startsWith("/mail-reference") === true) {
    return <span>{children}</span>;
  }
  return (
    <a href={href} {...props} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
};

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
