"use client";

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";
import { IconButtonTooltip } from "./icon-button-tooltip";

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
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
      {toolbar}
    </div>
    <div
      className={cn("grid min-h-0 flex-1", {
        "xl:grid-cols-[9rem_minmax(0,1fr)_15rem]":
          palette !== undefined && inspector !== undefined,
      })}
    >
      {palette !== undefined && (
        <aside
          aria-label="Email blocks"
          className="border-b border-border p-3 xl:border-r xl:border-b-0"
        >
          {palette}
        </aside>
      )}
      <div className="min-w-0 overflow-x-auto bg-muted/45 p-4 sm:p-7">
        {canvas}
      </div>
      {inspector !== undefined && (
        <aside
          aria-label="Email properties"
          className="border-t border-border p-4 xl:border-t-0 xl:border-l"
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
    className="mx-auto min-h-120 max-w-full shadow-sm transition-[width] duration-150 motion-reduce:transition-none"
    // oxlint-disable-next-line shadcn/no-inline-styles -- The email document controls its export width.
    style={{ width: device === "mobile" ? 360 : width, ...style }}
  >
    {children}
  </div>
);

export const EmailCanvasBlock = ({
  children,
  disabled = false,
  first,
  label,
  last,
  onDelete,
  onDuplicate,
  onMove,
  onSelect,
  selected,
}: {
  children: ReactNode;
  disabled?: boolean;
  first: boolean;
  label: string;
  last: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onSelect: () => void;
  selected: boolean;
}) => (
  <div className="group relative">
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
    {selected && !disabled ? (
      <div className="absolute -top-9 right-0 z-20 flex items-center gap-0.5 rounded-md border border-border bg-bg-surface p-0.5 shadow-sm">
        {[
          {
            disabled: first,
            icon: ArrowUp01Icon,
            label: "Move block up",
            onClick: () => {
              onMove(-1);
            },
          },
          {
            disabled: last,
            icon: ArrowDown01Icon,
            label: "Move block down",
            onClick: () => {
              onMove(1);
            },
          },
          {
            disabled: false,
            icon: Copy01Icon,
            label: "Duplicate block",
            onClick: onDuplicate,
          },
          {
            disabled: false,
            icon: Delete02Icon,
            label: "Delete block",
            onClick: onDelete,
          },
        ].map((action) => (
          <IconButtonTooltip key={action.label} label={action.label}>
            <Button
              aria-label={action.label}
              disabled={action.disabled}
              onClick={() => {
                action.onClick();
              }}
              size="icon-xs"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={action.icon} />
            </Button>
          </IconButtonTooltip>
        ))}
      </div>
    ) : null}
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
