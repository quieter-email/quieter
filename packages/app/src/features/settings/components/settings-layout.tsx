"use client";

import { LoadingSpinner } from "@quieter/app/components/loading-spinner";
import { useSettingsAnchor } from "@quieter/app/features/settings/components/use-settings-anchor";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  SettingsCard,
  SettingsRowLayout,
  SettingsSectionLayout,
} from "@quieter/ui/settings-layout";
import { Text } from "@quieter/ui/text";
import type { ReactNode } from "react";

export {
  SettingsCard,
  SettingsFieldRow,
  SettingsInlineLoading,
  SettingsInsetFieldRow,
  SettingsInsetRow,
  SettingsInsetRows,
  SettingsInsetStackedRow,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
  SettingsRowText,
  settingsSurfaceVariants,
} from "@quieter/ui/settings-layout";

export const SettingsSection = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  title?: string;
}) => {
  const { ref } = useSettingsAnchor(title ?? "");
  return (
    <SettingsSectionLayout
      anchorRef={ref}
      description={description}
      title={title}
    >
      {children}
    </SettingsSectionLayout>
  );
};

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
}) => {
  const { ref, selected } = useSettingsAnchor(title);
  return (
    <SettingsRowLayout
      action={action}
      anchorRef={ref}
      icon={icon}
      selected={selected}
      title={title}
    >
      {children}
    </SettingsRowLayout>
  );
};

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

export const SettingsErrorState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <SettingsCard variant="error">
    <Text role="alert" tone="destructive">
      {message}
    </Text>
    <Button onClick={onRetry} size="sm" type="button" variant="outline">
      Try again
    </Button>
  </SettingsCard>
);
