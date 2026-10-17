"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

export const Breadcrumbs = ({
  items,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"nav">, "children"> & {
  items: { id: string; content: ReactNode }[];
}) => (
  <nav aria-label="Breadcrumb" className={className} {...props}>
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-fg">
      {items.map((item, index) => (
        <li
          className="inline-flex min-w-0 items-center gap-2 [&_[aria-current=page]]:text-fg [&_a]:rounded-sm [&_a]:hover:text-fg [&_a]:focus-visible:text-fg [&_a]:focus-visible:outline-1 [&_a]:focus-visible:outline-ring"
          key={item.id}
        >
          {index > 0 && <span aria-hidden>/</span>}
          {item.content}
        </li>
      ))}
    </ol>
  </nav>
);
