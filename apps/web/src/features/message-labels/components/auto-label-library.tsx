"use client";

import { AiMagicIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Pill } from "@quieter/ui/pill";
import { useState } from "react";

import {
  autoLabelPresetCategories,
  autoLabelPresets,
} from "#/features/message-labels/domain/auto-label-presets";
import type { AutoLabelPreset } from "#/features/message-labels/domain/auto-label-presets";
import {
  mailboxLabelIconClassNameByColor,
  mailboxLabelPillToneByColor,
} from "#/features/message-labels/domain/mailbox-label-presentation";

export const AutoLabelLibrary = ({
  canManage,
  labels,
  onChoosePreset,
}: {
  canManage: boolean;
  labels: MailboxLabel[];
  onChoosePreset: (preset: AutoLabelPreset | null) => void;
}) => {
  const [category, setCategory] =
    useState<(typeof autoLabelPresetCategories)[number]>("All presets");
  const categories = autoLabelPresetCategories.filter(
    (item) =>
      item !== "All presets" &&
      (category === "All presets" || item === category)
  );

  return (
    <div className="grid gap-6 md:grid-cols-[9rem_minmax(0,1fr)]">
      <nav
        aria-label="Preset categories"
        className="min-w-0 md:sticky md:top-0 md:self-start"
      >
        <p className="mb-3 text-caption font-medium text-muted-fg">
          Categories
        </p>
        <div className="flex flex-wrap gap-1 md:flex-col md:items-stretch">
          {autoLabelPresetCategories.map((item) => (
            <Button
              aria-pressed={category === item}
              className="justify-start"
              key={item}
              onClick={() => {
                setCategory(item);
              }}
              type="button"
              variant="option"
            >
              {item}
            </Button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-7">
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-bg-raised p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-fg">
            <HugeiconsIcon aria-hidden className="size-4" icon={AiMagicIcon} />
          </span>
          <div className="min-w-40 flex-1">
            <h3 className="text-body font-medium text-fg">Make it your own</h3>
            <p className="mt-1 text-caption text-muted-fg">
              Start with a prompt, a sender, or a few words.
            </p>
          </div>
          <Button
            disabled={!canManage}
            onClick={() => {
              onChoosePreset(null);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Build your own
          </Button>
        </div>

        {categories.map((item) => (
          <section
            aria-labelledby={`preset-category-${item}`}
            className="space-y-3"
            key={item}
          >
            <h3
              className="text-body font-medium text-fg"
              id={`preset-category-${item}`}
            >
              {item}
            </h3>
            <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
              {autoLabelPresets
                .filter((preset) => preset.category === item)
                .map((preset) => {
                  const existingLabel = labels.find(
                    (label) =>
                      label.name.toLowerCase() === preset.name.toLowerCase()
                  );
                  return (
                    <Button
                      disabled={!canManage}
                      key={preset.id}
                      onClick={() => {
                        onChoosePreset(preset);
                      }}
                      type="button"
                      variant="result"
                    >
                      <span
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-lg",
                          mailboxLabelIconClassNameByColor[preset.color]
                        )}
                      >
                        <HugeiconsIcon
                          aria-hidden
                          className="size-5"
                          icon={preset.icon}
                        />
                      </span>
                      <span className="min-w-0 flex-1 space-y-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <Pill
                            size="xs"
                            tone={mailboxLabelPillToneByColor[preset.color]}
                          >
                            {preset.name}
                          </Pill>
                          {existingLabel ? (
                            <span className="text-micro text-muted-fg">
                              Label exists
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-caption/5 text-muted-fg">
                          {preset.description}
                        </span>
                      </span>
                      <HugeiconsIcon
                        aria-hidden
                        className="size-3.5"
                        icon={ArrowRight01Icon}
                      />
                    </Button>
                  );
                })}
            </div>
          </section>
        ))}
        <p className="text-caption text-muted-fg">
          Every preset is a starting point. Review its examples and change what
          belongs before saving.
        </p>
      </div>
    </div>
  );
};
