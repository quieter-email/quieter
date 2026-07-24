"use client";

import type { ReactNode } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";

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
    className={cn("fixed top-4 left-4 z-50 text-muted-foreground hover:text-foreground", className)}
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
        <h1 className="text-xl font-normal tracking-tight text-foreground">{title}</h1>
        {children && (
          <div className="mt-2 max-w-2xl text-sm/6 text-muted-foreground">{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
    {(title || description) && (
      <div>
        {title && <h2 className="text-sm font-normal text-foreground">{title}</h2>}
        {description && (
          <div className="mt-1 max-w-3xl text-sm/6 text-muted-foreground">{description}</div>
        )}
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
      "@container overflow-hidden rounded-lg border border-border/70 bg-background/58 squircle",
      className,
    )}
  >
    {children}
  </div>
);

export const settingsInsetDividerClass =
  "relative after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden @md:after:inset-x-6";
export const settingsRowTitleClass = "text-[0.8rem] font-normal text-foreground";
export const settingsRowValueClass = "text-xs leading-4 text-muted-foreground";
export const settingsRowPaddingClass = "px-4 py-3 @md:px-6";
export const settingsDivideClass = "divide-y divide-border/70";

export const settingsInsetRowClass = cn("flex w-full items-center gap-4", settingsRowPaddingClass);

export const settingsInsetFieldRowClass = cn(
  "flex w-full flex-col gap-4 @md:flex-row @md:items-center @md:justify-between",
  settingsRowPaddingClass,
);

export const settingsInsetStackedRowClass = cn(
  "flex w-full flex-col gap-3 @md:flex-row @md:items-center",
  settingsRowPaddingClass,
);

export const settingsListRowClass = cn(
  "flex flex-col gap-3 border-b border-border/70 last:border-b-0 @md:flex-row @md:items-center @md:justify-between",
  settingsRowPaddingClass,
);

export const settingsInsetSectionClass = cn(settingsInsetDividerClass, settingsRowPaddingClass);

export const SettingsInsetRows = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn(settingsDivideClass, className)}>{children}</div>;

export const SettingsInsetRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn(settingsInsetRowClass, className)}>{children}</div>;

export const SettingsInsetFieldRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn(settingsInsetFieldRowClass, className)}>{children}</div>;

export const SettingsInsetStackedRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn(settingsInsetStackedRowClass, className)}>{children}</div>;

export const SettingsListRow = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn(settingsListRowClass, className)}>{children}</div>;

const settingsRowShellClass = cn(
  "flex w-full items-center gap-4 squircle",
  settingsRowPaddingClass,
  settingsInsetDividerClass,
);

const settingsFieldRowShellClass = cn(
  "flex w-full flex-col items-start justify-between gap-4 @md:flex-row @md:items-center",
  settingsRowPaddingClass,
  settingsInsetDividerClass,
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
    <p className={settingsRowTitleClass}>{title}</p>
    {children && <div className={cn("mt-0.5", settingsRowValueClass)}>{children}</div>}
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
  <div className={settingsFieldRowShellClass}>
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
  <div className={settingsRowShellClass}>
    {icon && (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground squircle [&_svg]:size-4">
        {icon}
      </div>
    )}
    <SettingsRowText className="flex-1" title={title}>
      {children}
    </SettingsRowText>
    {action && <div className="ml-auto shrink-0">{action}</div>}
  </div>
);

export const SettingsNavigationRow = ({
  description,
  icon,
  meta,
  onClick,
  title,
}: {
  description: string;
  icon?: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
  title: string;
}) => (
  <button
    className={cn(
      settingsRowShellClass,
      "group text-left transition-colors outline-none squircle hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    )}
    onClick={onClick}
    type="button"
  >
    {icon && (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground transition-colors squircle group-hover:bg-muted/70 group-hover:text-foreground [&_svg]:size-4">
        {icon}
      </div>
    )}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[0.8rem] font-normal text-foreground">{title}</span>
      <span className={cn("mt-0.5 block truncate", settingsRowValueClass)}>{description}</span>
    </span>
    {meta && <span className="hidden text-xs text-muted-foreground @sm:block">{meta}</span>}
    <HugeiconsIcon
      aria-hidden
      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
      icon={ArrowRight01Icon}
    />
  </button>
);
