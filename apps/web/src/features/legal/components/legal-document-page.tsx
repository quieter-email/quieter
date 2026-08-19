import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const LegalDocumentPage = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) => (
  <div className="min-h-dvh bg-bg text-fg">
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3 border-b border-border pb-8">
        <p className="text-body text-muted-fg">
          <Link className="underline hover:text-fg" to="/home">
            Quieter
          </Link>
        </p>
        <h1 className="text-title-md font-medium tracking-tight">{title}</h1>
        <p className="text-body text-muted-fg">{description}</p>
        <p className="text-caption text-muted-fg">
          Last updated June 29, 2026.
        </p>
      </header>

      <article className="typeset typeset-docs mt-10 max-w-[37em]">
        {children}
      </article>
    </div>
  </div>
);
