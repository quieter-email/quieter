"use client";

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import { LoadingSpinner } from "#/components/loading-spinner";

export const settingsSurfaceVariants = cva("", {
  variants: {
    variant: {
      divide: "divide-y divide-border/70",
      divider:
        "relative after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:after:inset-x-6",
      fieldRowShell:
        "relative flex w-full flex-col items-start justify-between gap-4 px-4 py-3 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:flex-row @md:items-center @md:px-6 @md:after:inset-x-6",
      insetFieldRow:
        "flex w-full flex-col gap-4 px-4 py-3 @md:flex-row @md:items-center @md:justify-between @md:px-6",
      insetRow: "flex w-full items-center gap-4 px-4 py-3 @md:px-6",
      insetSection:
        "relative px-4 py-3 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:px-6 @md:after:inset-x-6",
      insetStackedRow:
        "flex w-full flex-col gap-3 px-4 py-3 @md:flex-row @md:items-center @md:px-6",
      listRow:
        "flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0 @md:flex-row @md:items-center @md:justify-between @md:px-6",
      padding: "px-4 py-3 @md:px-6",
      rowShell:
        "squircle relative flex w-full items-center gap-4 px-4 py-3 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:px-6 @md:after:inset-x-6",
      title: "text-[0.8rem] font-normal text-fg",
      value: "text-xs/4 text-muted-fg",
    },
  },
});

export const SettingsBackButton = ({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) => (
  <Button
    className={cn(
      "fixed top-4 left-4 z-50 text-muted-fg hover:text-fg",
      className
    )}
    onClick={onClick}
    size="sm"
    variant="ghost"
  >
    <HugeiconsIcon aria-hidden className="size-4" icon={ArrowLeft01Icon} />
    {children}
  </Button>
);

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
        <h1 className="text-xl font-normal tracking-tight text-fg">{title}</h1>
        {children !== undefined && children !== null ? (
          <div className="mt-2 max-w-2xl text-sm/6 text-muted-fg">
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

export const SettingsSection = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  title?: string;
}) => (
  <section className="space-y-4">
    {((title ?? "") !== "" ||
      (description !== undefined && description !== null)) && (
      <div>
        {(title ?? "") === "" ? null : (
          <h2 className="text-sm font-normal text-fg">{title}</h2>
        )}
        {description !== undefined && description !== null ? (
          <div className="mt-1 max-w-3xl text-sm/6 text-muted-fg">
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
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "squircle @container overflow-hidden rounded-lg border border-border bg-bg/60",
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

export const SettingsListRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(settingsSurfaceVariants({ variant: "listRow" }), className)}
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
    <div className="shrink-0">{action}</div>
  </div>
);

export const SettingsRow = ({
  action,
  children,
  icon,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  title: string;
}) => (
  <div className={settingsSurfaceVariants({ variant: "rowShell" })}>
    {icon !== undefined && icon !== null ? (
      <div className="squircle flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-fg [&_svg]:size-4">
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
      "group squircle border border-transparent text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/20 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none focus-visible:ring-inset",
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
      <div className="squircle flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-fg transition-colors group-hover:bg-muted/70 group-hover:text-fg [&_svg]:size-4">
        {icon}
      </div>
    ) : null}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[0.8rem] font-normal text-fg">
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
      <span className="hidden text-xs text-muted-fg @sm:block">{meta}</span>
    ) : null}
    <HugeiconsIcon
      aria-hidden
      className="size-4 shrink-0 text-muted-fg transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
      icon={ArrowRight01Icon}
    />
  </button>
);

export const SettingsLoadingState = ({
  className,
  label = "Loading settings",
}: {
  className?: string;
  label?: string;
}) => (
  <output
    aria-label={label}
    aria-live="polite"
    className={cn("flex min-h-24 items-center justify-center", className)}
  >
    <LoadingSpinner className="size-8 text-muted-fg" />
    <span className="sr-only">{label}</span>
  </output>
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

export const SettingsErrorState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <SettingsCard className="flex min-h-15 items-center justify-between gap-4 px-4 py-3">
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
    <Button onClick={onRetry} size="sm" type="button" variant="outline">
      Try again
    </Button>
  </SettingsCard>
);
