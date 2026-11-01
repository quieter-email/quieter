"use client";

import {
  ArrowRight01Icon,
  Attachment01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import {
  ComposerActionBar,
  ComposerContextChip,
} from "@quieter/ui/composer-chrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { useState } from "react";

import { initialPreviewDraft, previewSnippets } from "./preview-data";

export const ComposePreview = () => {
  const [draft, setDraft] = useState(initialPreviewDraft);
  const [sent, setSent] = useState(false);
  const [attached, setAttached] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) {
          setSent(true);
        }
      }}
    >
      <Surface>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Text as="span" size="sm" tone="muted">
              To
            </Text>
            <Text as="span" size="sm">
              alex@example.com
            </Text>
          </div>
          <Textarea
            aria-label="Sample reply"
            onChange={(event) => {
              setDraft(event.target.value);
              setSent(false);
            }}
            placeholder="Write a reply…"
            rows={5}
            value={draft}
            variant="prompt"
          />
          {attached ? (
            <ComposerContextChip
              icon={<Icon icon={Attachment01Icon} />}
              label="proposal.pdf"
              onRemove={() => {
                setAttached(false);
              }}
            />
          ) : null}
          <ComposerActionBar className="justify-between">
            <Button disabled={!draft.trim() || sent} type="submit">
              {sent ? "Sent" : "Send"}
              <Icon icon={sent ? CheckmarkCircle02Icon : ArrowRight01Icon} />
            </Button>
            {sent ? (
              <Button
                onClick={() => {
                  setSent(false);
                }}
                variant="ghost"
              >
                Undo
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <IconButtonTooltip
                  label={
                    attached
                      ? "Remove sample attachment"
                      : "Add sample attachment"
                  }
                >
                  <Button
                    aria-label={
                      attached
                        ? "Remove sample attachment"
                        : "Add sample attachment"
                    }
                    aria-pressed={attached}
                    onClick={() => {
                      setAttached(!attached);
                    }}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Icon icon={Attachment01Icon} />
                  </Button>
                </IconButtonTooltip>
                <IconButtonTooltip label="Clear sample draft">
                  <Button
                    aria-label="Clear sample draft"
                    onClick={() => {
                      setDraft("");
                      setAttached(false);
                    }}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Icon icon={Delete02Icon} />
                  </Button>
                </IconButtonTooltip>
                <DropdownMenu>
                  <IconButtonTooltip label="Draft options">
                    <DropdownMenuTrigger
                      render={
                        <Button
                          aria-label="Draft options"
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Icon icon={MoreHorizontalIcon} />
                        </Button>
                      }
                    />
                  </IconButtonTooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setDraft(initialPreviewDraft);
                        setSent(false);
                        setAttached(false);
                      }}
                    >
                      Reset draft
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setDraft(previewSnippets[1].body);
                        setSent(false);
                      }}
                    >
                      Use a quick follow-up
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </ComposerActionBar>
          <span aria-live="polite" className="sr-only">
            {sent ? "Sample reply sent." : ""}
          </span>
        </div>
      </Surface>
    </form>
  );
};
