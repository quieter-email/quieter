"use client";

import type { ComposeEmailInput, ComposeEmailResult } from "@quieter/ai";
import { composeDraftFormValuesSchema, composeSendFormValuesSchema } from "@quieter/mail/compose";
import { Button, cn } from "@quieter/ui";
import { useForm } from "@tanstack/react-form";
import { type FormEvent, useState } from "react";
import type { ComposeFormValues } from "~/features/compose/domain/compose-form";
import { ComposeEditor } from "~/features/compose/components/compose-editor";
import { getRenderableComposeBodyHtml } from "~/features/compose/domain/draft";
import type { InlineComposeAction } from "../../types";
import { ToolStep } from "./tools/tool-step";

type InlineComposeToolProps = {
  disabled?: boolean;
  initial: ComposeEmailInput;
  onResolve: (action: InlineComposeAction, message?: ComposeFormValues) => Promise<void>;
  processing?: boolean;
  result?: ComposeEmailResult;
};

const fieldClass =
  "h-8 w-full min-w-0 bg-transparent px-0 text-sm text-foreground outline-none placeholder:text-muted-foreground/60";

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
  <label className="flex min-w-0 items-center gap-3 border-b border-border/50 py-1.5 last:border-b-0">
    <span className="w-12 shrink-0 text-[11px] text-muted-foreground">{label}</span>
    {readOnly ? (
      <span className={cn(fieldClass, "truncate")}>{value || "—"}</span>
    ) : (
      <input
        aria-label={label}
        className={fieldClass}
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

  const detail = [result.to, result.subject].filter(Boolean).join(" · ");

  return (
    <ToolStep
      detail={detail ? `"${detail}"` : undefined}
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
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyHtml = getRenderableComposeBodyHtml("", initial.bodyText);
  const detail = [initial.to, initial.subject].filter(Boolean).join(" · ");

  return (
    <ToolStep
      detail={detail ? `"${detail}"` : undefined}
      expandable
      expanded={expanded}
      label="Declined draft"
      onToggle={() => setExpanded((current) => !current)}
    >
      <div className="space-y-0">
        <ComposeField label="To" readOnly value={initial.to} />
        {initial.cc.trim() ? <ComposeField label="Cc" readOnly value={initial.cc} /> : null}
        {initial.bcc.trim() ? <ComposeField label="Bcc" readOnly value={initial.bcc} /> : null}
        <ComposeField label="Subject" readOnly value={initial.subject} />
        <div className="py-2 text-sm/relaxed text-muted-foreground">
          {bodyHtml ? (
            <div
              className="prose prose-sm max-w-none text-sm dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
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
  const [showCc, setShowCc] = useState(!!initial.cc.trim());
  const [showBcc, setShowBcc] = useState(!!initial.bcc.trim());
  const [pendingAction, setPendingAction] = useState<InlineComposeAction | null>(null);
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
    if (disabled || processing || pendingAction) {
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
            : "Could not decline the email.",
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
      setError(
        actionError instanceof Error && actionError.message
          ? actionError.message
          : action === "send"
            ? "Could not send the email."
            : "Could not save the draft.",
      );
      setPendingAction(null);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void resolve("send");
  };
  const isBusy = !!(processing || pendingAction);

  return (
    <form className="border-l border-border/70 pl-3" onSubmit={handleSubmit}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {processing ? "Sending email" : "Draft email"}
          {initial.subject.trim() ? (
            <span className="text-foreground/75">{` "${initial.subject}"`}</span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <button
            className={cn("text-muted-foreground transition-colors hover:text-foreground", {
              "text-foreground": showCc,
            })}
            onClick={() => setShowCc((current) => !current)}
            type="button"
          >
            Cc
          </button>
          <button
            className={cn("text-muted-foreground transition-colors hover:text-foreground", {
              "text-foreground": showBcc,
            })}
            onClick={() => setShowBcc((current) => !current)}
            type="button"
          >
            Bcc
          </button>
        </div>
      </div>

      <fieldset disabled={disabled || isBusy}>
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
              className="mt-2 border-0 bg-transparent shadow-none focus-within:border-0 focus-within:ring-0"
              compact
              disabled={disabled || isBusy}
              html={field.state.value}
              onBlur={field.handleBlur}
              onChange={({ html, text }) => {
                setError(null);
                field.handleChange(html);
                form.setFieldValue("bodyText", text);
              }}
              onInlineImageFiles={() => undefined}
              showToolbar={false}
            />
          )}
        </form.Field>
      </fieldset>

      <div className="mt-3 flex items-center gap-2">
        {error ? (
          <p aria-live="polite" className="min-w-0 flex-1 truncate text-xs text-destructive">
            {error}
          </p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <Button
          disabled={disabled || isBusy}
          onClick={() => void resolve("decline")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {pendingAction === "decline" ? "Declining…" : "Decline"}
        </Button>
        <Button
          disabled={disabled || isBusy}
          onClick={() => void resolve("save_draft")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {pendingAction === "save_draft" ? "Saving…" : "Save draft"}
        </Button>
        <Button disabled={disabled || isBusy} size="sm" type="submit">
          {pendingAction === "send" ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
};

// Re-export for any external imports
export { ComposeDeclinedView, ComposeReceipt };
