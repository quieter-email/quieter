"use client";

import {
  Loading03Icon,
  NoteEditIcon,
  NoteIcon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Input } from "@quieter/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@quieter/ui/popover";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type RefObject } from "react";
import { USER_BILLING_QUERY_KEY } from "~/features/settings/domain/billing";
import { orpc } from "~/lib/orpc";
import type { ComposeEditorHandle } from "./compose-editor";
import {
  TEMPLATE_PLACEHOLDER_PATTERN,
  type TemplatePlaceholderRange,
} from "../domain/template-placeholders";

type MailTemplateItem = {
  bodyHtml: string;
  canEdit: boolean;
  id: string;
  name: string;
  scope: "personal" | "team";
};

const TemplateScopeBadge = ({ scope }: { scope: MailTemplateItem["scope"] }) => (
  <span
    className={cn(
      "rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
      {
        "border-border bg-muted/45 text-muted-foreground": scope === "personal",
        "border-primary/20 bg-primary/8 text-primary": scope === "team",
      },
    )}
  >
    {scope === "team" ? "Team" : "Personal"}
  </span>
);

export const ComposeTemplatePicker = ({
  disabled,
  mailboxId,
  onInsert,
  onManage,
}: {
  disabled?: boolean;
  mailboxId: string;
  onInsert: (template: MailTemplateItem) => void;
  onManage: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryOptions = orpc.mailTemplates.list.queryOptions({ input: { mailboxId } });
  const templatesQuery = useQuery(queryOptions);
  const templates = templatesQuery.data?.templates ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredTemplates = normalizedSearch
    ? templates.filter((template) => template.name.toLowerCase().includes(normalizedSearch))
    : templates;

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          aria-label="Insert template"
          className="keyboard-focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted/55 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          type="button"
        >
          <HugeiconsIcon className="size-4" icon={NoteIcon} />
          Templates
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(88vw,22rem)] p-0" side="top">
          <div className="border-b p-3">
            <PopoverTitle>Insert a template</PopoverTitle>
            <label className="relative mt-2 block">
              <HugeiconsIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                icon={Search01Icon}
              />
              <Input
                aria-label="Search templates"
                className="pl-8"
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search"
                size="sm"
                value={search}
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {filteredTemplates.map((template) => (
              <button
                className="keyboard-focus-ring flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted/60"
                key={template.id}
                onClick={() => {
                  onInsert(template);
                  setOpen(false);
                }}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {template.name}
                  </span>
                </span>
                <TemplateScopeBadge scope={template.scope} />
              </button>
            ))}
            {templatesQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                <HugeiconsIcon className="size-3.5 animate-spin" icon={Loading03Icon} />
                Loading templates
              </div>
            ) : templatesQuery.isError ? (
              <p className="px-3 py-8 text-center text-xs/5 text-destructive">
                Could not load templates.
              </p>
            ) : filteredTemplates.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs/5 text-muted-foreground">
                {templates.length === 0 ? "No templates yet." : "No templates match this search."}
              </p>
            ) : null}
          </div>
          <div className="border-t p-2">
            <Button
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={NoteEditIcon} />
              Manage templates
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
};

export const TemplatePlaceholderSuggestion = ({
  bodyText,
  disabled,
  editorRef,
  mailboxId,
  placeholder,
  recipients,
  subject,
  templateName,
}: {
  bodyText: string;
  disabled?: boolean;
  editorRef: RefObject<ComposeEditorHandle | null>;
  mailboxId: string;
  placeholder: TemplatePlaceholderRange | null;
  recipients: string;
  subject: string;
  templateName: string;
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{ key: string; value: string } | null>(null);
  const mutation = useMutation(orpc.mailTemplates.suggestPlaceholder.mutationOptions());
  const key = placeholder
    ? `${placeholder.from}:${placeholder.to}:${placeholder.label}:${bodyText}`
    : "";
  const currentSuggestion = suggestion?.key === key ? suggestion.value : null;

  if (!placeholder) return null;

  const requestSuggestion = () => {
    setOpen(true);
    if (mutation.isPending) return;

    mutation.mutate(
      {
        bodyText: bodyText.replaceAll(
          TEMPLATE_PLACEHOLDER_PATTERN,
          (_match, label: string) => `[Placeholder: ${label}]`,
        ),
        mailboxId,
        placeholder: placeholder.label,
        recipients,
        subject,
        templateName,
      },
      {
        onError: (error) => toast.error(error.message || "Could not suggest a value."),
        onSuccess: async ({ value }) => {
          await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
          if (!value) {
            toast.message("There is not enough context to suggest this value.");
            setOpen(false);
            return;
          }
          setSuggestion({ key, value });
        },
      },
    );
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={`Suggest a value for ${placeholder.label}`}
        className="keyboard-focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/8 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={requestSuggestion}
        type="button"
      >
        <HugeiconsIcon
          className={cn("size-4", { "animate-spin": mutation.isPending })}
          icon={mutation.isPending ? Loading03Icon : SparklesIcon}
        />
        Suggest “{placeholder.label}”
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(88vw,22rem)]" side="top">
        <PopoverTitle>Suggested value</PopoverTitle>
        {currentSuggestion ? (
          <>
            <p className="mt-3 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-sm/6 text-foreground">
              {currentSuggestion}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
                Dismiss
              </Button>
              <Button
                onClick={() => {
                  if (!editorRef.current?.replaceSelectedPlaceholder(currentSuggestion)) {
                    toast.error("Select the placeholder again before using this suggestion.");
                    return;
                  }
                  setOpen(false);
                }}
                size="sm"
                type="button"
              >
                Use suggestion
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
            <HugeiconsIcon className="size-4 animate-spin" icon={Loading03Icon} />
            Looking for a value in this message…
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
