"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { cva } from "class-variance-authority";
import type { ReactNode, Ref } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";

export const settingsSurfaceVariants = cva("", {
  variants: {
    variant: {
      body: "space-y-3 px-4 py-(--settings-row-padding) @md:px-6",
      divide: "divide-y divide-border/70",
      divider:
        "relative after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:after:inset-x-6",
      fieldRowShell:
        "relative flex w-full flex-col items-start justify-between gap-4 px-4 py-(--settings-row-padding) after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:flex-row @md:items-center @md:px-6 @md:after:inset-x-6",
      footer:
        "flex flex-wrap items-center justify-between gap-3 px-4 py-(--settings-row-padding) @md:px-6",
      form: "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2",
      insetFieldRow:
        "flex w-full flex-col gap-4 px-4 py-(--settings-row-padding) @md:flex-row @md:items-center @md:justify-between @md:px-6",
      insetRow:
        "flex w-full items-center gap-4 px-4 py-(--settings-row-padding) @md:px-6",
      insetSection:
        "relative px-4 py-(--settings-row-padding) after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:px-6 @md:after:inset-x-6",
      insetStackedRow:
        "flex w-full flex-col gap-3 px-4 py-(--settings-row-padding) @md:flex-row @md:items-center @md:px-6",
      padding: "px-4 py-(--settings-row-padding) @md:px-6",
      page: "@container space-y-8",
      rowShell:
        "squircle relative flex w-full items-center gap-4 px-4 py-(--settings-row-padding) after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:px-6 @md:after:inset-x-6",
      title: "truncate text-body-sm font-medium text-fg",
      value: "text-body-sm/5 text-muted-fg",
    },
  },
});

export const SettingsPageHeader = ({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  title: string;
}) => (
  <div className="@container">
    <header className="flex flex-col gap-3 @md:flex-row @md:items-end @md:justify-between">
      <div className="min-w-0">
        <h1 className="truncate font-sans text-body-lg font-medium text-fg">
          {title}
        </h1>
        {children !== undefined && children !== null ? (
          <div className="mt-2 max-w-2xl text-body-sm/5 text-muted-fg">
            {children}
          </div>
        ) : null}
      </div>
      {action !== undefined && action !== null ? (
        <div className="shrink-0">{action}</div>
      ) : null}
    </header>
  </div>
);

export const SettingsSectionLayout = ({
  anchorRef,
  children,
  description,
  title,
}: {
  anchorRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  description?: ReactNode;
  title?: string;
}) => (
  <section ref={anchorRef} className="space-y-4">
    {((title ?? "") !== "" ||
      (description !== undefined && description !== null)) && (
      <div>
        {(title ?? "") === "" ? null : (
          <h2 className="truncate text-body-sm font-medium text-fg">{title}</h2>
        )}
        {description !== undefined && description !== null ? (
          <div className="mt-1 max-w-3xl text-body-sm/5 text-muted-fg">
            {description}
          </div>
        ) : null}
      </div>
    )}
    {children}
  </section>
);

export const SettingsCard = ({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "error";
}) => (
  <div
    className={cn(
      "@container overflow-hidden rounded-lg border border-border bg-bg-surface squircle",
      {
        "flex min-h-15 items-center justify-between gap-4 px-4 py-(--settings-row-padding) @md:px-6":
          variant === "error",
      },
      className
    )}
  >
    {children}
  </div>
);

export const SettingsInsetRows = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(settingsSurfaceVariants({ variant: "divide" }), className)}
  >
    {children}
  </div>
);

export const SettingsInsetRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(settingsSurfaceVariants({ variant: "insetRow" }), className)}
  >
    {children}
  </div>
);

export const SettingsInsetFieldRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      settingsSurfaceVariants({ variant: "insetFieldRow" }),
      className
    )}
  >
    {children}
  </div>
);

export const SettingsInsetStackedRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      settingsSurfaceVariants({ variant: "insetStackedRow" }),
      className
    )}
  >
    {children}
  </div>
);

export const SettingsRows = ({ children }: { children: ReactNode }) => (
  <SettingsCard>
    <div>{children}</div>
  </SettingsCard>
);

export const SettingsRowText = ({
  children,
  className,
  title,
}: {
  children?: ReactNode;
  className?: string;
  title: ReactNode;
}) => (
  <div className={cn("min-w-0", className)}>
    <p className={settingsSurfaceVariants({ variant: "title" })}>{title}</p>
    {children !== undefined && children !== null ? (
      <div
        className={cn("mt-0.5", settingsSurfaceVariants({ variant: "value" }))}
      >
        {children}
      </div>
    ) : null}
  </div>
);

export const SettingsFieldRow = ({
  action,
  label,
  value,
}: {
  action: ReactNode;
  label: string;
  value: ReactNode;
}) => (
  <div className={settingsSurfaceVariants({ variant: "fieldRowShell" })}>
    <SettingsRowText title={label}>{value}</SettingsRowText>
    <div className="w-full min-w-0 @md:w-auto @md:shrink-0">{action}</div>
  </div>
);

export const SettingsRowLayout = ({
  action,
  anchorRef,
  children,
  icon,
  selected,
  title,
}: {
  action?: ReactNode;
  anchorRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  title: string;
}) => (
  <div
    ref={anchorRef}
    className={cn(settingsSurfaceVariants({ variant: "rowShell" }), {
      "bg-accent": selected,
    })}
  >
    {icon !== undefined && icon !== null ? (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-fg squircle [&_svg]:size-4">
        {icon}
      </div>
    ) : null}
    <SettingsRowText className="flex-1" title={title}>
      {children}
    </SettingsRowText>
    {action !== undefined && action !== null ? (
      <div className="ml-auto shrink-0">{action}</div>
    ) : null}
  </div>
);

export const SettingsNavigationRow = ({
  description,
  disabled,
  icon,
  meta,
  onClick,
  onIntent,
  title,
}: {
  description: string;
  disabled?: boolean;
  icon?: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
  onIntent?: () => void;
  title: string;
}) => (
  <button
    className={cn(
      settingsSurfaceVariants({ variant: "rowShell" }),
      "group border border-transparent text-left transition-colors squircle first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none focus-visible:ring-inset",
      { "pointer-events-none": disabled }
    )}
    disabled={disabled}
    onFocus={onIntent}
    onMouseEnter={onIntent}
    onClick={onClick}
    onPointerDown={(event) => {
      if (event.pointerType !== "mouse") {
        onIntent?.();
      }
    }}
    type="button"
  >
    {icon !== undefined && icon !== null ? (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-fg transition-colors squircle group-hover:text-fg [&_svg]:size-4">
        {icon}
      </div>
    ) : null}
    <span className="min-w-0 flex-1">
      <span
        className={cn(
          "block truncate",
          settingsSurfaceVariants({ variant: "title" })
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "mt-0.5 block truncate",
          settingsSurfaceVariants({ variant: "value" })
        )}
      >
        {description}
      </span>
    </span>
    {meta !== undefined && meta !== null ? (
      <span className="hidden text-caption text-muted-fg @sm:block">
        {meta}
      </span>
    ) : null}
    <Icon
      aria-hidden
      tone="muted"
      className="group-hover:translate-x-0.5 group-hover:text-fg"
      icon={ArrowRight01Icon}
    />
  </button>
);

export const SettingsInlineLoading = ({ label }: { label: string }) => (
  <output
    aria-label={label}
    aria-live="polite"
    className="inline-flex w-12 justify-end"
  >
    <span
      aria-hidden
      className="h-2 w-10 animate-pulse rounded-full bg-muted/65 motion-reduce:animate-none"
    />
    <span className="sr-only">{label}</span>
  </output>
);
