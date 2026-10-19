"use client";

import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Input } from "@quieter/ui/input";
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

const promptExamples = [
  {
    name: "Work",
    prompt:
      "Conversations about my work, including projects, clients, colleagues, and meetings.",
  },
  {
    name: "Personal",
    prompt:
      "Personal conversations, everyday accounts, shopping, hobbies, and messages from friends and family.",
  },
  {
    name: "Finance",
    prompt:
      "Messages about payments, invoices, receipts, and financial accounts. Exclude promotions.",
  },
] as const;

export const AutoLabelEditor = ({
  canManage,
  isPending,
  label,
  onCancel,
  onSave,
}: {
  canManage: boolean;
  isPending: boolean;
  label: MailboxLabel;
  onCancel: () => void;
  onSave: (settings: AutoLabelSettings) => Promise<boolean>;
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
  const [showConditions, setShowConditions] = useState(
    initialSettings.senders.length > 0 ||
      initialSettings.domains.length > 0 ||
      initialSettings.keywords.length > 0
  );
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
  const disabled = !canManage || isPending;

  const saveSettings = async () => {
    setShowErrors(true);
    if (!parsed.success) {
      setShowConditions(true);
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onCancel();
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[min(92vw,36rem)] flex-col">
        <form
          aria-label={`Auto-label ${label.name}`}
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings();
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>Auto-label settings</DialogTitle>
            <DialogDescription>
              Automatically apply {label.name} to matching new Inbox mail.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="5">
            <div className="flex items-start justify-between gap-4">
              <p className="text-caption text-muted-fg">
                Automatically apply this label
              </p>
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
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-caption text-muted-fg">
                    Examples
                  </span>
                  {promptExamples.map((example) => (
                    <Button
                      disabled={disabled}
                      key={example.name}
                      onClick={() => {
                        setSettings((current) => ({
                          ...current,
                          prompt: example.prompt,
                        }));
                      }}
                      size="compact"
                      type="button"
                      variant="ghost"
                    >
                      {example.name}
                    </Button>
                  ))}
                </div>
                <p
                  className="text-caption text-muted-fg"
                  id={`${id}-prompt-help`}
                >
                  {hasConditions
                    ? "AI checks your prompt after the conditions below match."
                    : "Describe what belongs here. Leave blank to use the label's name and description."}
                </p>
              </div>

              <Button
                aria-controls={`${id}-conditions`}
                aria-expanded={showConditions}
                onClick={() => {
                  setShowConditions((current) => !current);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {showConditions
                  ? "Hide conditions"
                  : "Sender, domain, or word conditions"}
              </Button>
              {showConditions ? (
                <div
                  className="space-y-4 border-t border-border pt-4"
                  id={`${id}-conditions`}
                >
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
                            setSettings((current) => ({
                              ...current,
                              matchMode: mode,
                            }));
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
                      From senders
                    </label>
                    <Input
                      aria-describedby={`${id}-senders-help`}
                      aria-invalid={
                        showErrors &&
                        validationErrors.some(
                          (issue) => issue.path[0] === "senders"
                        )
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
                    <p
                      className="text-caption text-muted-fg"
                      id={`${id}-senders-help`}
                    >
                      Exact email addresses, separated by commas.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="flex items-center gap-2 text-caption font-medium text-fg"
                      htmlFor={`${id}-domains`}
                    >
                      From domains
                    </label>
                    <Input
                      aria-describedby={`${id}-domains-help`}
                      aria-invalid={
                        showErrors &&
                        validationErrors.some(
                          (issue) => issue.path[0] === "domains"
                        )
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
                    <p
                      className="text-caption text-muted-fg"
                      id={`${id}-domains-help`}
                    >
                      <span className="font-mono">example.com</span> matches
                      that domain.{" "}
                      <span className="font-mono">*.example.com</span> matches
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
                            setSettings((current) => ({
                              ...current,
                              keywordScope,
                            }));
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
                          <SelectItem value="anywhere">
                            Subject or body
                          </SelectItem>
                          <SelectItem value="subject">Subject only</SelectItem>
                          <SelectItem value="body">Body only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      aria-describedby={`${id}-keywords-help`}
                      aria-invalid={
                        showErrors &&
                        validationErrors.some(
                          (issue) => issue.path[0] === "keywords"
                        )
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
                      Words or phrases, separated by commas. Capitalization does
                      not matter.
                    </p>
                  </div>
                </div>
              ) : null}
            </fieldset>

            {showErrors && validationErrors.length > 0 ? (
              <p className="text-caption text-destructive" role="alert">
                {validationErrors[0]?.message}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="shrink-0">
            <Button
              disabled={isPending}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={disabled}
              pending={isPending}
              pendingLabel="Saving…"
              size="sm"
              type="submit"
            >
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
