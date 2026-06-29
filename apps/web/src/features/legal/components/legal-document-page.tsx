import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export const LegalDocumentPage = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) => (
  <div className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3 border-b border-border/70 pb-8">
        <p className="text-sm text-muted-foreground">
          <Link className="underline hover:text-foreground" to="/home">
            Quieter
          </Link>
        </p>
        <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground">Last updated June 29, 2026.</p>
      </header>

      <article className="prose mt-10 max-w-none space-y-6 text-sm/7 text-foreground prose-neutral dark:prose-invert [&_h2]:mt-10 [&_h2]:text-base [&_h2]:font-medium [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:ps-5">
        {children}
      </article>
    </div>
  </div>
);
