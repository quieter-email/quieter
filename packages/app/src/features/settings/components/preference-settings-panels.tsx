"use client";

import { CodeIcon, KeyboardIcon } from "@hugeicons/core-free-icons";
import { ConsentPreferencesLink } from "@quieter/app/components/consent-preferences-link";
import { useKeyboardShortcuts } from "@quieter/app/features/hotkeys/components/keyboard-shortcuts-context";
import {
  isDemoModeAvailable,
  setDemoModeEnabled,
  useDemoModeEnabled,
} from "@quieter/app/features/settings/domain/demo-mode-setting";
import {
  setExternalImagesEnabled,
  useExternalImagesEnabled,
} from "@quieter/app/features/settings/domain/external-images-setting";
import {
  MAIL_LAYOUT_OPTIONS,
  setMailLayout,
  useMailLayout,
} from "@quieter/app/features/settings/domain/mail-layout-setting";
import {
  setManagedDemoModeEnabled,
  useManagedDemoModeEnabled,
} from "@quieter/app/features/settings/domain/managed-demo-mode-setting";
import { appRuntime } from "@quieter/app/runtime";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { ThemePicker } from "@quieter/ui/theme-picker";

import { DateTimeSettings } from "./date-time-settings";
import { DefaultMailboxSetting } from "./default-mailbox-setting";
import {
  SettingsCard,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "./settings-layout";

export const PreferencesSettingsPanel = () => {
  const mailLayout = useMailLayout();
  const externalImagesEnabled = useExternalImagesEnabled();
  const { openKeyboardShortcuts } = useKeyboardShortcuts();
  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <DefaultMailboxSetting />
      <DateTimeSettings />
      <SettingsSection title="Appearance">
        <SettingsRows>
          <SettingsRow action={<ThemePicker />} title="Theme" />
          <SettingsRow
            title="Mail layout"
            action={
              <Select
                items={MAIL_LAYOUT_OPTIONS}
                value={mailLayout}
                onValueChange={(value) => {
                  const option = MAIL_LAYOUT_OPTIONS.find(
                    (item) => item.value === value
                  );
                  if (option) {
                    setMailLayout(option.value);
                  }
                }}
              >
                <SelectTrigger
                  aria-label="Mail layout"
                  className="w-36"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {MAIL_LAYOUT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            Full view opens mail full width. Split view keeps your inbox beside
            the message. Small screens use full view.
          </SettingsRow>
          <SettingsRow
            action={
              <Button
                onClick={openKeyboardShortcuts}
                size="sm"
                type="button"
                variant="outline"
              >
                <Icon
                  aria-hidden

                  icon={KeyboardIcon}
                />
                View
              </Button>
            }
            title="Keyboard shortcuts"
          />
        </SettingsRows>
      </SettingsSection>
      <SettingsSection title="Privacy and content">
        <SettingsRows>
          <SettingsRow
            action={
              <Switch
                aria-label="Allow external images"
                checked={externalImagesEnabled}
                className="shrink-0"
                size="sm"
                id="external-images-toggle"
                onCheckedChange={setExternalImagesEnabled}
              >
                <SwitchThumb />
              </Switch>
            }
            title="Allow external images"
          >
            When disabled, remote images stay hidden until you allow them for
            the open message.
          </SettingsRow>
          {appRuntime.platform === "desktop" ? null : (
            <SettingsRow
              action={<ConsentPreferencesLink variant="button" />}
              title="Cookie and analytics preferences"
            >
              Choose which optional cookies and measurement tools quieter may
              use in this browser.
            </SettingsRow>
          )}
        </SettingsRows>
      </SettingsSection>
    </div>
  );
};

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
              className="shrink-0"
              size="sm"
              id="demo-mode-toggle"
              onCheckedChange={setDemoModeEnabled}
            >
              <SwitchThumb />
            </Switch>
          }
          title="Gmail demo mailbox"
        >
          Replace real mailbox data with local Gmail demo messages while
          developing.
        </SettingsRow>
        <SettingsRow
          action={
            <Switch
              checked={managedDemoModeEnabled}
              className="shrink-0"
              size="sm"
              id="managed-demo-mode-toggle"
              onCheckedChange={setManagedDemoModeEnabled}
            >
              <SwitchThumb />
            </Switch>
          }
          title="Managed demo mailbox"
        >
          Replace real mailbox data with local managed-mail fixtures: labels,
          threads, and inbox states. Nothing is sent for real.
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
};

export const DevelopmentSettingsUnavailable = () => (
  <SettingsSection title="Development">
    <SettingsCard className={settingsSurfaceVariants({ variant: "body" })}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden tone="muted" className="mt-0.5" icon={CodeIcon} />
        <p className="text-body text-muted-fg">
          Local demo mailbox options are only available in development builds.
        </p>
      </div>
    </SettingsCard>
  </SettingsSection>
);
