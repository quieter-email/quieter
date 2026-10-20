"use client";

import {
  ArrowDown01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
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
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <DialogTitle>
                  <span className="block truncate">
                    Auto-label {label.name}
                  </span>
                </DialogTitle>
              </div>
              <label
                className="flex shrink-0 items-center gap-2 text-caption text-muted-fg"
                htmlFor={`${id}-enabled`}
              >
                {settings.enabled ? "On" : "Paused"}
                <Switch
                  aria-label={`Enable auto-label for ${label.name}`}
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
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
            <fieldset className="space-y-5" disabled={disabled}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    className="text-caption font-medium text-fg"
                    htmlFor={`${id}-prompt`}
                  >
                    AI prompt
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={disabled}
                      render={
                        <Button size="compact" type="button" variant="ghost" />
                      }
                    >
                      Examples
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" size="compact">
                      {promptExamples.map((example) => (
                        <DropdownMenuItem
                          key={example.name}
                          onSelect={() => {
                            setSettings((current) => ({
                              ...current,
                              prompt: example.prompt,
                            }));
                          }}
                        >
                          {example.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Textarea
                  id={`${id}-prompt`}
                  maxLength={4000}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }));
                  }}
                  placeholder="Describe the emails to label…"
                  rows={3}
                  value={settings.prompt}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    aria-controls={`${id}-conditions`}
                    aria-expanded={showConditions}
                    onClick={() => {
                      setShowConditions((current) => !current);
                    }}
                    size="compact"
                    type="button"
                    variant="ghost"
                  >
                    Conditions
                    <HugeiconsIcon
                      aria-hidden
                      className={cn("size-3.5", {
                        "rotate-180": showConditions,
                      })}
                      icon={ArrowDown01Icon}
                    />
                  </Button>
                  {showConditions ? (
                    <IconButtonTooltip label="Match all requires every filled field; match any requires one. Entries within a field use any. Separate entries with commas. Domains are exact; *.example.com matches subdomains.">
                      <Button
                        aria-label="Condition matching help"
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon
                          aria-hidden
                          icon={InformationCircleIcon}
                        />
                      </Button>
                    </IconButtonTooltip>
                  ) : null}
                </div>
                {showConditions ? (
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
                        variant="secondary"
                      >
                        Match {mode}
                      </Toggle>
                    ))}
                  </ToggleGroup>
                ) : null}
              </div>
              {showConditions ? (
                <div className="space-y-4" id={`${id}-conditions`}>
                  <div className="space-y-1.5">
                    <label
                      className="flex items-center gap-2 text-caption font-medium text-fg"
                      htmlFor={`${id}-senders`}
                    >
                      Senders
                    </label>
                    <Input
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
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="flex items-center gap-2 text-caption font-medium text-fg"
                      htmlFor={`${id}-domains`}
                    >
                      Domains
                    </label>
                    <Input
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
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        className="flex items-center gap-2 text-caption font-medium text-fg"
                        htmlFor={`${id}-keywords`}
                      >
                        Words
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
                      placeholder="invoice, payment received"
                      value={keywords}
                    />
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
          <DialogFooter className="shrink-0" fullWidth>
            <Button
              disabled={isPending}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="secondary"
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
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
