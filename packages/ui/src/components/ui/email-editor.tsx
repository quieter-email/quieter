"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "../../lib/cn";

export const EmailEditorLayout = ({
  canvas,
  inspector,
  palette,
  toolbar,
}: {
  canvas: ReactNode;
  inspector?: ReactNode;
  palette?: ReactNode;
  toolbar: ReactNode;
}) => (
  <div className="flex min-h-160 flex-col overflow-hidden rounded-xl border border-border bg-bg-surface">
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
      {toolbar}
    </div>
    {palette === undefined ? null : (
      <div className="min-w-0 border-b border-border px-2 py-1.5">
        {palette}
      </div>
    )}
    <div
      className={cn("grid min-h-0 flex-1", {
        "lg:grid-cols-[minmax(0,1fr)_16rem]": inspector !== undefined,
      })}
    >
      <div className="min-w-0 overflow-x-auto bg-muted/40 p-4 sm:p-6">
        {canvas}
      </div>
      {inspector === undefined ? null : (
        <aside
          aria-label="Email properties"
          className="border-t border-border p-3 lg:border-t-0 lg:border-l"
        >
          {inspector}
        </aside>
      )}
    </div>
  </div>
);

export const EmailCanvas = ({
  children,
  device,
  style,
  width = 600,
}: {
  children: ReactNode;
  device: "desktop" | "mobile";
  style?: CSSProperties;
  width?: number;
}) => (
  <div
    className="mx-auto max-w-full shadow-sm transition-[width] duration-150 motion-reduce:transition-none"
    // oxlint-disable-next-line shadcn/no-inline-styles -- The email document controls its export width.
    style={{ width: device === "mobile" ? 360 : width, ...style }}
  >
    {children}
  </div>
);

export const EmailCanvasBlock = ({
  children,
  label,
  onSelect,
  selected,
}: {
  children: ReactNode;
  label: string;
  onSelect: () => void;
  selected: boolean;
}) => (
  <div className="relative">
    <div className="pointer-events-none">{children}</div>
    <button
      aria-label={`Edit ${label} block`}
      aria-pressed={selected}
      className={cn(
        "absolute inset-0 rounded-sm outline-2 outline-offset-2 outline-transparent transition-colors hover:outline-primary/35 focus-visible:outline-primary",
        { "outline-primary": selected }
      )}
      onClick={onSelect}
      type="button"
    />
  </div>
);

export const EmailPreview = ({
  className,
  device = "desktop",
  html,
  text,
  title = "Email preview",
}: {
  className?: string;
  device?: "desktop" | "mobile";
  html: string | null;
  text: string;
  title?: string;
}) => (
  <div
    className={cn(
      "mx-auto w-full",
      { "max-w-90": device === "mobile" },
      className
    )}
  >
    {html === null ? (
      <div className="min-h-120 bg-bg-surface p-8 text-body/7 whitespace-pre-wrap text-fg">
        {text}
      </div>
    ) : (
      <iframe
        className="h-160 w-full border-0 bg-bg-surface"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'"><base target="_blank">${html}`}
        title={title}
      />
    )}
  </div>
);
