"use client";

import { ArrowLeft02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type {
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useId, useState } from "react";

import { AutoLabelEditor } from "#/features/message-labels/components/auto-label-editor";
import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import type { AutoLabelPreset } from "#/features/message-labels/domain/auto-label-presets";

export const AutoLabelSetup = ({
  canManage,
  isPending,
  labels,
  mailboxProvider,
  onBack,
  onSave,
  preset,
}: {
  canManage: boolean;
  isPending: boolean;
  labels: MailboxLabel[];
  mailboxProvider: "gmail" | "managed";
  onBack: () => void;
  onSave: (input: {
    autoLabel: AutoLabelSettings;
    color: MailboxLabelColor;
    existingLabel: MailboxLabel | undefined;
    name: string;
    preset: AutoLabelPreset | null;
  }) => Promise<boolean>;
  preset: AutoLabelPreset | null;
}) => {
  const id = useId();
  const [targetLabelId, setTargetLabelId] = useState(
    () =>
      labels.find(
        (label) => label.name.toLowerCase() === preset?.name.toLowerCase()
      )?.id ?? "new"
  );
  const [name, setName] = useState(preset?.name ?? "");
  const [color, setColor] = useState<MailboxLabelColor>(
    preset?.color ?? "gray"
  );
  const [showNameError, setShowNameError] = useState(false);
  const existingLabel = labels.find((label) => label.id === targetLabelId);
  let nameError: string | null = null;
  if (name.trim() === "") {
    nameError = "Give this label a name.";
  } else if (
    labels.some((item) => item.name.toLowerCase() === name.trim().toLowerCase())
  ) {
    nameError = "A label with this name already exists. Choose it above.";
  }
  const autoLabel: AutoLabelSettings = {
    domains: preset?.domains ?? [],
    enabled: true,
    keywordScope: "anywhere",
    keywords: [],
    matchMode: "all",
    prompt: preset?.prompt ?? "",
    senders: [],
  };
  const label: MailboxLabel = existingLabel
    ? {
        ...existingLabel,
        autoLabel: preset ? autoLabel : existingLabel.autoLabel,
      }
    : {
        autoLabel,
        color,
        description: preset?.description ?? null,
        id: "new",
        inclusionCriteria: null,
        name: name.trim() || "New label",
        position: labels.length,
        provider: mailboxProvider,
        type: "user",
        visible: true,
      };

  return (
    <div className="space-y-5">
      <Button
        disabled={isPending}
        onClick={onBack}
        size="sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden icon={ArrowLeft02Icon} />
        Back to presets
      </Button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            <label
              className="text-caption font-medium text-fg"
              htmlFor={`${id}-target`}
            >
              Apply to label
            </label>
            <Select
              disabled={!canManage || isPending}
              items={[
                { label: "Create a new label", value: "new" },
                ...labels.map((item) => ({ label: item.name, value: item.id })),
              ]}
              onValueChange={(value) => {
                if (value !== null) {
                  setTargetLabelId(value);
                }
              }}
              value={targetLabelId}
            >
              <SelectTrigger id={`${id}-target`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Create a new label</SelectItem>
                {labels.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {existingLabel === undefined ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label
                  className="text-caption font-medium text-fg"
                  htmlFor={`${id}-name`}
                >
                  Label name
                </label>
                <Input
                  aria-describedby={
                    showNameError ? `${id}-name-error` : undefined
                  }
                  aria-invalid={showNameError && nameError !== null}
                  disabled={!canManage || isPending}
                  id={`${id}-name`}
                  maxLength={225}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  placeholder="e.g. Receipts"
                  value={name}
                />
              </div>
              <MailboxColorPicker
                label="Label color"
                onChange={setColor}
                value={color}
              />
              {showNameError && nameError !== null ? (
                <p
                  className="text-caption text-destructive"
                  id={`${id}-name-error`}
                  role="alert"
                >
                  {nameError}
                </p>
              ) : null}
            </div>
          ) : null}
          <AutoLabelEditor
            canManage={canManage}
            isPending={isPending}
            key={targetLabelId}
            label={label}
            onSave={async (settings) => {
              setShowNameError(true);
              if (existingLabel === undefined && nameError !== null) {
                return false;
              }
              return await onSave({
                autoLabel: settings,
                color,
                existingLabel,
                name: name.trim(),
                preset,
              });
            }}
            saveLabel={existingLabel ? "Save changes" : "Create auto-label"}
          />
        </div>
        <aside className="min-w-0 space-y-4">
          <div>
            <h3 className="text-body font-medium text-fg">
              {preset ? "Example emails" : "Make the match specific"}
            </h3>
            <p className="mt-2 text-caption/5 text-muted-fg">
              {preset
                ? "A few examples of what belongs in this preset."
                : "Use any combination of a prompt and conditions. Empty fields are ignored."}
            </p>
          </div>
          {preset?.examples.map((example) => (
            <div
              className="space-y-2 rounded-lg border border-border bg-bg-raised p-4"
              key={example.subject}
            >
              <HugeiconsIcon
                aria-hidden
                className="size-4 text-muted-fg"
                icon={Mail01Icon}
              />
              <p className="text-caption font-medium text-fg">
                {example.subject}
              </p>
              <p className="text-caption break-words text-muted-fg">
                {example.sender}
              </p>
            </div>
          ))}
          <div className="space-y-3 rounded-lg bg-muted/40 p-4 text-caption/5 text-muted-fg">
            <p>
              <span className="font-medium text-fg">Senders</span>
              <br />
              An exact address like alex@example.com.
            </p>
            <p>
              <span className="font-medium text-fg">Domains</span>
              <br />
              Use *.example.com for subdomains. Add example.com to include the
              main domain too.
            </p>
            <p>
              <span className="font-medium text-fg">Words</span>
              <br />
              Match a phrase in the subject, body, or either.
            </p>
          </div>
          {preset ? (
            <p className="text-caption text-muted-fg">
              These are illustrative examples, not messages from your inbox.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
