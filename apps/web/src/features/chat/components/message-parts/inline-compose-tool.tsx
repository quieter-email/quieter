"use client";

import type {
  ComposeEmailInput,
  ComposeEmailResult,
} from "@quieter/ai/chat-agent";
import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useForm } from "@tanstack/react-form";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import {
  ComposeEditor,
  ComposeEditorBody,
} from "#/features/compose/components/compose-editor";
import type { ComposeFormValues } from "#/features/compose/domain/compose-form";
import {
  getRenderableComposeBodyHtml,
  normalizeComposeBodyHtml,
} from "#/features/compose/domain/draft";
import { getAppPresenceMotion } from "#/features/motion/app-motion";

import type { InlineComposeAction } from "../../types";
import { getToolIcon } from "./tools/tool-icons";
import { ToolStep } from "./tools/tool-step";

const composeToolIcon = getToolIcon("compose_email");

type InlineComposeToolProps = {
  disabled?: boolean;
  initial: ComposeEmailInput;
  onResolve: (
    action: InlineComposeAction,
    message?: ComposeFormValues
  ) => Promise<void>;
  processing?: boolean;
  result?: ComposeEmailResult;
};

const ComposeField = ({
  label,
  value,
  onBlur,
  onChange,
  readOnly = false,
}: {
  label: string;
  onBlur?: () => void;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  value: string;
}) => (
  <label className="flex min-w-0 items-center gap-3 border-b border-border py-1.5 last:border-b-0">
    <span className="w-12 shrink-0 text-micro text-muted-fg">{label}</span>
    {readOnly ? (
      <span className="h-8 w-full min-w-0 truncate bg-transparent px-0 text-sm text-fg">
        {value || "—"}
      </span>
    ) : (
      <input
        aria-label={label}
        className="h-8 w-full min-w-0 bg-transparent px-0 text-sm text-fg placeholder:text-muted-fg/60"
        onBlur={onBlur}
        onChange={(event) => onChange?.(event.target.value)}
        value={value}
      />
    )}
  </label>
);

const ComposeReceipt = ({ result }: { result: ComposeEmailResult }) => {
  if (result.status === "declined") {
    return null;
  }

  const detail = [result.to ? `To ${result.to}` : "", result.subject]
    .filter(Boolean)
    .join(" ");

  return (
    <ToolStep
      detail={detail ? `"${detail}"` : undefined}
      icon={composeToolIcon}
      label={result.status === "sent" ? "Sent email" : "Saved draft"}
    />
  );
};

const ComposeDeclinedView = ({
  initial,
  defaultExpanded = false,
}: {
  defaultExpanded?: boolean;
  initial: ComposeEmailInput;
}) => {
  const bodyText = initial.bodyText.trim();
  const detail = [initial.to ? `To ${initial.to}` : "", initial.subject]
    .filter(Boolean)
    .join(" ");

  return (
    <ToolStep
      active={defaultExpanded}
      detail={detail ? `"${detail}"` : undefined}
      expandable
      icon={composeToolIcon}
      label="Declined draft"
    >
      <div className="space-y-0">
        <ComposeField label="To" readOnly value={initial.to} />
        {initial.cc.trim() ? (
          <ComposeField label="Cc" readOnly value={initial.cc} />
        ) : null}
        {initial.bcc.trim() ? (
          <ComposeField label="Bcc" readOnly value={initial.bcc} />
        ) : null}
        <ComposeField label="Subject" readOnly value={initial.subject} />
        <div className="py-2 text-sm/relaxed text-muted-fg">
          {bodyText ? (
            <p className="max-w-[37em] whitespace-pre-wrap">{bodyText}</p>
          ) : (
            <p>No message body.</p>
          )}
        </div>
      </div>
    </ToolStep>
  );
};

export const InlineComposeTool = ({
  disabled,
  initial,
  onResolve,
  processing,
  result,
}: InlineComposeToolProps) => {
  const shouldReduceMotion = useReducedMotion();
  const [showCc, setShowCc] = useState(!!initial.cc.trim());
  const [showBcc, setShowBcc] = useState(!!initial.bcc.trim());
  const [pendingAction, setPendingAction] =
    useState<InlineComposeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      bcc: initial.bcc,
      bodyHtml: getRenderableComposeBodyHtml("", initial.bodyText),
      bodyText: initial.bodyText,
      cc: initial.cc,
      subject: initial.subject,
      to: initial.to,
    } satisfies ComposeFormValues,
  });

  if (result?.status === "declined") {
    return <ComposeDeclinedView initial={initial} />;
  }

  if (result) {
    return <ComposeReceipt result={result} />;
  }

  const resolve = async (action: InlineComposeAction) => {
    if (disabled === true || processing === true || pendingAction !== null) {
      return;
    }

    if (action === "decline") {
      setError(null);
      setPendingAction(action);

      try {
        await onResolve(action);
      } catch (actionError) {
        setError(
          actionError instanceof Error && actionError.message
            ? actionError.message
            : "Could not decline the email."
        );
        setPendingAction(null);
      }

      return;
    }

    const parsed =
      action === "send"
        ? composeSendFormValuesSchema.safeParse(form.state.values)
        : composeDraftFormValuesSchema.safeParse(form.state.values);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the email fields.");
      return;
    }

    setError(null);
    setPendingAction(action);

    try {
      await onResolve(action, parsed.data);
    } catch (actionError) {
      const fallbackMessage =
        action === "send"
          ? "Could not send the email."
          : "Could not save the draft.";
      setError(
        actionError instanceof Error && actionError.message
          ? actionError.message
          : fallbackMessage
      );
      setPendingAction(null);
    }
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void resolve("send");
  };
  const isBusy = processing === true || pendingAction !== null;

  return (
    <form
      className="rounded-md border border-border bg-bg-surface p-3"
      onSubmit={handleSubmit}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-fg">
          {processing === true ? "Sending email" : "Draft email"}
          {initial.subject.trim() ? (
            <span className="text-fg/75">{` "${initial.subject}"`}</span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2 text-micro">
          <button
            className={cn("text-muted-fg transition-colors hover:text-fg", {
              "text-fg": showCc,
            })}
            onClick={() => {
              setShowCc((current) => !current);
            }}
            type="button"
          >
            Cc
          </button>
          <button
            className={cn("text-muted-fg transition-colors hover:text-fg", {
              "text-fg": showBcc,
            })}
            onClick={() => {
              setShowBcc((current) => !current);
            }}
            type="button"
          >
            Bcc
          </button>
        </div>
      </div>

      <fieldset disabled={disabled === true || isBusy}>
        <form.Field name="to">
          {(field) => (
            <ComposeField
              label="To"
              onBlur={field.handleBlur}
              onChange={(value) => {
                setError(null);
                field.handleChange(value);
              }}
              value={field.state.value}
            />
          )}
        </form.Field>
        {showCc ? (
          <form.Field name="cc">
            {(field) => (
              <ComposeField
                label="Cc"
                onBlur={field.handleBlur}
                onChange={(value) => {
                  setError(null);
                  field.handleChange(value);
                }}
                value={field.state.value}
              />
            )}
          </form.Field>
        ) : null}
        {showBcc ? (
          <form.Field name="bcc">
            {(field) => (
              <ComposeField
                label="Bcc"
                onBlur={field.handleBlur}
                onChange={(value) => {
                  setError(null);
                  field.handleChange(value);
                }}
                value={field.state.value}
              />
            )}
          </form.Field>
        ) : null}
        <form.Field name="subject">
          {(field) => (
            <ComposeField
              label="Subject"
              onBlur={field.handleBlur}
              onChange={(value) => {
                setError(null);
                field.handleChange(value);
              }}
              value={field.state.value}
            />
          )}
        </form.Field>

        <form.Field name="bodyHtml">
          {(field) => (
            <ComposeEditor
              density="compact"
              disabled={disabled === true || isBusy}
              html={field.state.value}
              onBlur={field.handleBlur}
              onChange={({ html, text }) => {
                if (
                  normalizeComposeBodyHtml(html) !==
                    normalizeComposeBodyHtml(field.state.value) ||
                  text !== form.state.values.bodyText
                ) {
                  setError(null);
                }
                field.handleChange(html);
                form.setFieldValue("bodyText", text);
              }}
              onInlineImageFiles={(files) => {
                void files;
              }}
            >
              <ComposeEditorBody className="mt-2 p-4" />
            </ComposeEditor>
          )}
        </form.Field>
      </fieldset>

      <div className="mt-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <AnimatePresence initial={false}>
            {error !== null && error !== undefined && error !== "" ? (
              <m.p
                {...getAppPresenceMotion({
                  distance: 2,
                  reducedMotion: shouldReduceMotion,
                })}
                aria-live="polite"
                className="truncate text-xs text-destructive"
              >
                {error}
              </m.p>
            ) : null}
          </AnimatePresence>
        </div>
        <Button
          disabled={disabled === true || isBusy}
          onClick={() => void resolve("decline")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {pendingAction === "decline" ? "Declining…" : "Decline"}
        </Button>
        <Button
          disabled={disabled === true || isBusy}
          onClick={() => void resolve("save_draft")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {pendingAction === "save_draft" ? "Saving…" : "Save draft"}
        </Button>
        <Button disabled={disabled === true || isBusy} size="sm" type="submit">
          {pendingAction === "send" ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
};

// Re-export for any external imports
export { ComposeDeclinedView, ComposeReceipt };
