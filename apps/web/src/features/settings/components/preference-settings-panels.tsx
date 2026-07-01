"use client";

import { CodeIcon, KeyboardIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { useColorMode, type ConfigColorMode } from "@quieter/ui/color-mode";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { ConsentPreferencesLink } from "~/components/consent-preferences-link";
import { useKeyboardShortcuts } from "~/features/hotkeys/components/keyboard-shortcuts-context";
import {
  isDemoModeAvailable,
  setDemoModeEnabled,
  useDemoModeEnabled,
} from "~/features/settings/domain/demo-mode-setting";
import {
  setExternalImagesEnabled,
  useExternalImagesEnabled,
} from "~/features/settings/domain/external-images-setting";
import {
  setManagedDemoModeEnabled,
  useManagedDemoModeEnabled,
} from "~/features/settings/domain/managed-demo-mode-setting";
import { SettingsCard, SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

const COLOR_MODE_OPTIONS: { label: string; value: ConfigColorMode }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
];

export const AppearanceSettingsPanel = () => {
  const { configColorMode, isMounted, setColorMode } = useColorMode();

  return (
    <SettingsSection title="Theme">
      <SettingsRows>
        <SettingsRow
          action={
            <Select
              items={COLOR_MODE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              onValueChange={(value) => {
                if (value === "light" || value === "dark" || value === "system") {
                  setColorMode(value);
                }
              }}
              value={isMounted ? configColorMode : null}
            >
              <SelectTrigger aria-label="Color mode" className="w-36" size="sm">
                <SelectValue placeholder="Theme" />
              </SelectTrigger>
              <SelectContent align="end">
                {COLOR_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          title="Color mode"
        >
          Choose how Quieter looks on this device.
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
};

export const ReadingSettingsPanel = () => {
  const externalImagesEnabled = useExternalImagesEnabled();

  return (
    <SettingsSection title="Images">
      <SettingsRows>
        <SettingsRow
          action={
            <Switch
              aria-label="Allow external images"
              checked={externalImagesEnabled}
              className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
              id="external-images-toggle"
              onCheckedChange={setExternalImagesEnabled}
            >
              <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
            </Switch>
          }
          title="Allow external images"
        >
          When disabled, remote images stay hidden until you allow them for the open message.
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
};

export const ShortcutsSettingsPanel = () => {
  const { openKeyboardShortcuts } = useKeyboardShortcuts();

  return (
    <SettingsSection title="Shortcuts">
      <SettingsRows>
        <SettingsRow
          action={
            <Button onClick={openKeyboardShortcuts} size="sm" type="button" variant="outline">
              <HugeiconsIcon aria-hidden className="size-4 shrink-0" icon={KeyboardIcon} />
              View
            </Button>
          }
          title="Keyboard shortcuts"
        >
          Review the shortcuts for composing, navigating, and triaging mail.
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
};

export const PrivacySettingsPanel = () => (
  <SettingsSection title="Privacy preferences">
    <SettingsRows>
      <SettingsRow
        action={
          <ConsentPreferencesLink className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition-colors squircle hover:bg-muted/60" />
        }
        title="Cookie and analytics preferences"
      >
        Choose which optional cookies and measurement tools Quieter may use in this browser.
      </SettingsRow>
    </SettingsRows>
  </SettingsSection>
);

export const DevelopmentSettingsPanel = () => {
  const demoModeEnabled = useDemoModeEnabled();
  const managedDemoModeEnabled = useManagedDemoModeEnabled();

  if (!isDemoModeAvailable()) {
    return null;
  }

  return (
    <SettingsSection title="Demo mailboxes">
      <SettingsRows>
        <SettingsRow
          action={
            <Switch
              checked={demoModeEnabled}
              className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
              id="demo-mode-toggle"
              onCheckedChange={setDemoModeEnabled}
            >
              <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
            </Switch>
          }
          title="Gmail demo mailbox"
        >
          Replace real mailbox data with local Gmail demo messages while developing.
        </SettingsRow>
        <SettingsRow
          action={
            <Switch
              checked={managedDemoModeEnabled}
              className="h-5 w-9 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted p-0.5 data-checked:border-primary data-checked:bg-primary"
              id="managed-demo-mode-toggle"
              onCheckedChange={setManagedDemoModeEnabled}
            >
              <SwitchThumb className="size-4 bg-background-light data-checked:translate-x-4 data-checked:bg-primary-foreground" />
            </Switch>
          }
          title="Managed demo mailbox"
        >
          Replace real mailbox data with local managed-mail fixtures: labels, saved views, threads,
          and inbox states. Nothing is sent for real.
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
};

export const DevelopmentSettingsUnavailable = () => (
  <SettingsSection title="Development">
    <SettingsCard className="p-6">
      <div className="flex items-start gap-3">
        <HugeiconsIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          icon={CodeIcon}
        />
        <p className="text-sm text-muted-foreground">
          Local demo mailbox options are only available in development builds.
        </p>
      </div>
    </SettingsCard>
  </SettingsSection>
);
