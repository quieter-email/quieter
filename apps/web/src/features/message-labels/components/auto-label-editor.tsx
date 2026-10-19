"use client";

import {
  AiMagicIcon,
  Globe02Icon,
  Mail01Icon,
  TextIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { Input } from "@quieter/ui/input";
import { Pill } from "@quieter/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Textarea } from "@quieter/ui/textarea";
import { Toggle, ToggleGroup } from "@quieter/ui/toggle";
import { useId, useState } from "react";

import { mailboxLabelPillToneByColor } from "#/features/message-labels/domain/mailbox-label-presentation";

export const AutoLabelEditor = ({
  canManage,
  isPending,
  label,
  onSave,
  saveLabel = "Save changes",
}: {
  canManage: boolean;
  isPending: boolean;
  label: MailboxLabel;
  onSave: (settings: AutoLabelSettings) => Promise<boolean>;
  saveLabel?: string;
}) => {
  const id = useId();
  const initialSettings: AutoLabelSettings = label.autoLabel ?? {
    domains: [],
    enabled: true,
    keywordScope: "anywhere",
    keywords: [],
    matchMode: "all",
    prompt: label.inclusionCriteria ?? "",
    senders: [],
  };
  const [settings, setSettings] = useState(initialSettings);
  const [senders, setSenders] = useState(initialSettings.senders.join(", "));
  const [domains, setDomains] = useState(initialSettings.domains.join(", "));
  const [keywords, setKeywords] = useState(initialSettings.keywords.join(", "));
  const [showErrors, setShowErrors] = useState(false);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const draft = { ...settings, domains, keywords, senders };
  const serializedDraft = JSON.stringify(draft);
  const parsed = autoLabelSettingsSchema.safeParse({
    ...settings,
    domains: domains
      .split(/[,;\n]/u)
      .map((value) => value.trim())
      .filter(Boolean),
    keywords: keywords
      .split(/[,;\n]/u)
      .map((value) => value.trim())
      .filter(Boolean),
    prompt: settings.prompt.trim(),
    senders: senders
      .split(/[,;\n]/u)
      .map((value) => value.trim())
      .filter(Boolean),
  });
  const validationErrors = parsed.success ? [] : parsed.error.issues;
  const hasConditions = Boolean(
    senders.trim() || domains.trim() || keywords.trim()
  );
  const isSaved = savedDraft === serializedDraft;
  const disabled = !canManage || isPending;

  const saveSettings = async () => {
    setShowErrors(true);
    if (!parsed.success) {
      return;
    }
    if (await onSave(parsed.data)) {
      setSavedDraft(serializedDraft);
    }
  };

  return (
    <form
      className="min-w-0 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Pill
            size="xs"
            tone={mailboxLabelPillToneByColor[label.color ?? "gray"]}
          >
            {label.name}
          </Pill>
          <h2 className="text-body font-medium text-fg">
            When should this label apply?
          </h2>
        </div>
        <label
          className="flex shrink-0 items-center gap-2 text-caption text-muted-fg"
          htmlFor={`${id}-enabled`}
        >
          {settings.enabled ? "Enabled" : "Paused"}
          <Switch
            checked={settings.enabled}
            disabled={disabled}
            id={`${id}-enabled`}
            onCheckedChange={(enabled) => {
              setSettings((current) => ({ ...current, enabled }));
            }}
            size="sm"
          >
            <SwitchThumb />
          </Switch>
        </label>
      </div>

      <fieldset className="space-y-5" disabled={disabled}>
        <div className="space-y-2">
          <label
            className="flex items-center gap-2 text-body font-medium text-fg"
            htmlFor={`${id}-prompt`}
          >
            <HugeiconsIcon
              aria-hidden
              className="size-4 text-muted-fg"
              icon={AiMagicIcon}
            />
            AI prompt
            <span className="ml-auto text-caption font-normal text-muted-fg">
              Optional
            </span>
          </label>
          <Textarea
            aria-describedby={`${id}-prompt-help`}
            id={`${id}-prompt`}
            maxLength={4000}
            onChange={(event) => {
              setSettings((current) => ({
                ...current,
                prompt: event.target.value,
              }));
            }}
            placeholder="Describe the emails that belong here and anything to leave out…"
            rows={3}
            value={settings.prompt}
          />
          <p className="text-caption text-muted-fg" id={`${id}-prompt-help`}>
            {hasConditions
              ? "AI checks your prompt after the conditions below match."
              : "Describe the meaning or intent. Leave blank to use the label's name and description."}
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body font-medium text-fg">Conditions</p>
            <ToggleGroup
              aria-label="Match conditions"
              size="compact"
              value={[settings.matchMode]}
              variant="subtle"
            >
              {(["all", "any"] as const).map((mode) => (
                <Toggle
                  key={mode}
                  onClick={() => {
                    setSettings((current) => ({ ...current, matchMode: mode }));
                  }}
                  size="sm"
                  type="button"
                  value={mode}
                >
                  Match {mode}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <p className="text-caption text-muted-fg">
            {settings.matchMode === "all"
              ? "Every filled-in condition must match."
              : "At least one filled-in condition must match."}{" "}
            Any entry within a field can match.
          </p>

          <div className="space-y-1.5">
            <label
              className="flex items-center gap-2 text-caption font-medium text-fg"
              htmlFor={`${id}-senders`}
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5 text-muted-fg"
                icon={Mail01Icon}
              />
              From senders
            </label>
            <Input
              aria-describedby={`${id}-senders-help`}
              aria-invalid={
                showErrors &&
                validationErrors.some((issue) => issue.path[0] === "senders")
              }
              autoCapitalize="none"
              id={`${id}-senders`}
              onChange={(event) => {
                setSenders(event.target.value);
              }}
              placeholder="alex@example.com, billing@company.com"
              spellCheck={false}
              value={senders}
            />
            <p className="text-caption text-muted-fg" id={`${id}-senders-help`}>
              Exact email addresses, separated by commas.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              className="flex items-center gap-2 text-caption font-medium text-fg"
              htmlFor={`${id}-domains`}
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5 text-muted-fg"
                icon={Globe02Icon}
              />
              From domains
            </label>
            <Input
              aria-describedby={`${id}-domains-help`}
              aria-invalid={
                showErrors &&
                validationErrors.some((issue) => issue.path[0] === "domains")
              }
              autoCapitalize="none"
              id={`${id}-domains`}
              onChange={(event) => {
                setDomains(event.target.value);
              }}
              placeholder="example.com, *.example.com"
              spellCheck={false}
              value={domains}
            />
            <p className="text-caption text-muted-fg" id={`${id}-domains-help`}>
              <span className="font-mono">example.com</span> matches that
              domain. <span className="font-mono">*.example.com</span> matches
              subdomains like{" "}
              <span className="font-mono">news.example.com</span>.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                className="flex items-center gap-2 text-caption font-medium text-fg"
                htmlFor={`${id}-keywords`}
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5 text-muted-fg"
                  icon={TextIcon}
                />
                Contains words
              </label>
              <Select
                disabled={disabled}
                items={[
                  { label: "Subject or body", value: "anywhere" },
                  { label: "Subject only", value: "subject" },
                  { label: "Body only", value: "body" },
                ]}
                onValueChange={(keywordScope) => {
                  if (
                    keywordScope === "anywhere" ||
                    keywordScope === "subject" ||
                    keywordScope === "body"
                  ) {
                    setSettings((current) => ({ ...current, keywordScope }));
                  }
                }}
                value={settings.keywordScope}
              >
                <SelectTrigger
                  aria-label="Where to match words"
                  size="sm"
                  variant="ghost"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent size="compact">
                  <SelectItem value="anywhere">Subject or body</SelectItem>
                  <SelectItem value="subject">Subject only</SelectItem>
                  <SelectItem value="body">Body only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              aria-describedby={`${id}-keywords-help`}
              aria-invalid={
                showErrors &&
                validationErrors.some((issue) => issue.path[0] === "keywords")
              }
              id={`${id}-keywords`}
              onChange={(event) => {
                setKeywords(event.target.value);
              }}
              placeholder="invoice, payment received, order confirmation"
              value={keywords}
            />
            <p
              className="text-caption text-muted-fg"
              id={`${id}-keywords-help`}
            >
              Words or phrases, separated by commas. Capitalization does not
              matter.
            </p>
          </div>
        </div>
      </fieldset>

      {showErrors && validationErrors.length > 0 ? (
        <p className="text-caption text-destructive" role="alert">
          {validationErrors[0]?.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p aria-live="polite" className="text-caption text-muted-fg">
          {isSaved ? "Changes saved." : "Applies to new Inbox mail."}
        </p>
        <Button
          disabled={disabled || isSaved}
          pending={isPending}
          pendingLabel="Saving…"
          type="submit"
        >
          {saveLabel}
        </Button>
      </div>
    </form>
  );
};
