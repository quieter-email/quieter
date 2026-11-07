"use client";

import { MailReference } from "@quieter/app/features/chat/components/mail-reference";
import { parseMailReference } from "@quieter/app/features/chat/domain/mail-reference";
import type { ComponentPropsWithoutRef } from "react";
import { useRemarkSync } from "react-remark";

const markdownLink = ({
  children,
  href,
  ...props
}: ComponentPropsWithoutRef<"a">) => {
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

export const MarkdownContent = ({ markdown }: MarkdownContentProps) => {
  // oxlint-disable-next-line node/no-sync -- This renderer commits final text and follow-up actions together, without file I/O.
  const content = useRemarkSync(markdown, {
    rehypeReactOptions: { components: { a: markdownLink, img: markdownImage } },
    remarkToRehypeOptions: { allowDangerousHtml: false },
  });
  return <div className="typeset typeset-body">{content}</div>;
};
