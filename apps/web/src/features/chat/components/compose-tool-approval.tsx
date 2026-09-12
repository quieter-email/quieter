"use client";

import type { ComposeEmailInput } from "@quieter/ai/chat-agent";
import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { useState } from "react";
import type { ReactNode, SubmitEvent } from "react";

import { composeBodyHtmlFromText } from "../domain/compose-proposal";
import type { ComposeValues } from "../domain/compose-proposal";

const composeFieldControlClassName =
  "h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-body-sm shadow-none focus-visible:ring-0";

const ComposeFieldRow = ({
  children,
  label,
  last = false,
}: {
  children: ReactNode;
  label: string;
  last?: boolean;
}) => (
  <div
    className={cn("flex items-center gap-2.5 px-3", {
      "border-b border-border": !last,
    })}
  >
    <span className="w-14 shrink-0 text-caption text-muted-fg">{label}</span>
    {children}
  </div>
);

type ComposeToolApprovalProps = {
  disabled: boolean;
  initial: Omit<ComposeEmailInput, "action">;
  onDecline: () => void;
  onSubmit: (
    action: ComposeEmailInput["action"],
    values: ComposeValues
  ) => void;
};

export const ComposeToolApproval = ({
  disabled,
  initial,
  onDecline,
  onSubmit,
}: ComposeToolApprovalProps) => {
  const [message, setMessage] = useState(initial);
  const [error, setError] = useState("");

  const submit = (action: ComposeEmailInput["action"]) => {
    // The form schemas require the HTML alternative too, so validate against
    // the exact HTML that saving or sending will produce.
    const values = {
      bcc: message.bcc,
      bodyHtml: composeBodyHtmlFromText(message.bodyText),
      bodyText: message.bodyText,
      cc: message.cc,
      subject: message.subject,
      to: message.to,
    };
    const parsed =
      action === "send"
        ? composeSendFormValuesSchema.safeParse(values)
        : composeDraftFormValuesSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the email fields.");
      return;
    }
    setError("");
    onSubmit(action, {
      bcc: parsed.data.bcc,
      bodyText: parsed.data.bodyText,
      cc: parsed.data.cc,
      subject: parsed.data.subject,
      to: parsed.data.to,
    });
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit("send");
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="flex flex-col overflow-hidden rounded-md border border-border bg-control">
        <ComposeFieldRow label="To">
          <Input
            aria-label="To"
            className={composeFieldControlClassName}
            disabled={disabled}
            onChange={(event) => {
              setMessage((current) => ({ ...current, to: event.target.value }));
            }}
            placeholder="To"
            value={message.to}
          />
        </ComposeFieldRow>
        <ComposeFieldRow label="Subject">
          <Input
            aria-label="Subject"
            className={composeFieldControlClassName}
            disabled={disabled}
            onChange={(event) => {
              setMessage((current) => ({
                ...current,
                subject: event.target.value,
              }));
            }}
            placeholder="Subject"
            value={message.subject}
          />
        </ComposeFieldRow>
        <ComposeFieldRow label="Cc">
          <Input
            aria-label="Cc"
            className={composeFieldControlClassName}
            disabled={disabled}
            onChange={(event) => {
              setMessage((current) => ({ ...current, cc: event.target.value }));
            }}
            placeholder="Cc"
            value={message.cc}
          />
        </ComposeFieldRow>
        <ComposeFieldRow label="Bcc" last>
          <Input
            aria-label="Bcc"
            className={composeFieldControlClassName}
            disabled={disabled}
            onChange={(event) => {
              setMessage((current) => ({
                ...current,
                bcc: event.target.value,
              }));
            }}
            placeholder="Bcc"
            value={message.bcc}
          />
        </ComposeFieldRow>
      </div>
      <Textarea
        aria-label="Message body"
        className="min-h-24 resize-y bg-transparent shadow-none"
        disabled={disabled}
        onChange={(event) => {
          setMessage((current) => ({
            ...current,
            bodyText: event.target.value,
          }));
        }}
        placeholder="Write your message"
        value={message.bodyText}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error === "" ? null : (
          <p className="mr-auto text-caption text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          disabled={disabled}
          onClick={onDecline}
          size="sm"
          type="button"
          variant="ghost"
        >
          Decline
        </Button>
        <Button
          disabled={disabled}
          onClick={() => {
            submit("save_draft");
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Save draft
        </Button>
        <Button disabled={disabled} size="sm" type="submit">
          Send
        </Button>
      </div>
    </form>
  );
};
