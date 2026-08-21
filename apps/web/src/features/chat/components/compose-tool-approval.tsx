"use client";

import type { ComposeEmailInput } from "@quieter/ai/chat-agent";
import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import { Button } from "@quieter/ui/button";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { useState } from "react";
import type { SubmitEvent } from "react";

type ComposeToolApprovalProps = {
  disabled: boolean;
  initial: ComposeEmailInput;
  onApprove: (input: ComposeEmailInput) => void;
  onReject: () => void;
};

export const ComposeToolApproval = ({
  disabled,
  initial,
  onApprove,
  onReject,
}: ComposeToolApprovalProps) => {
  const [message, setMessage] = useState(initial);
  const [error, setError] = useState("");

  const approve = (action: ComposeEmailInput["action"]) => {
    const values = {
      bcc: message.bcc,
      bodyHtml: "",
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
    onApprove({ action, ...parsed.data });
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    approve("send");
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label="To"
          disabled={disabled}
          onChange={(event) => {
            setMessage((current) => ({ ...current, to: event.target.value }));
          }}
          placeholder="To"
          value={message.to}
        />
        <Input
          aria-label="Subject"
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
        <Input
          aria-label="Cc"
          disabled={disabled}
          onChange={(event) => {
            setMessage((current) => ({ ...current, cc: event.target.value }));
          }}
          placeholder="Cc"
          value={message.cc}
        />
        <Input
          aria-label="Bcc"
          disabled={disabled}
          onChange={(event) => {
            setMessage((current) => ({ ...current, bcc: event.target.value }));
          }}
          placeholder="Bcc"
          value={message.bcc}
        />
      </div>
      <Textarea
        aria-label="Message body"
        className="min-h-40 resize-y"
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
          onClick={onReject}
          size="sm"
          type="button"
          variant="ghost"
        >
          Decline
        </Button>
        <Button
          disabled={disabled}
          onClick={() => {
            approve("save_draft");
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
