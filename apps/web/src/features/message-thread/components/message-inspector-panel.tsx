"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { MessageDeliverySection } from "#/features/message-delivery/components/message-delivery-section";
import { getMessageInspectorOptions } from "#/lib/gmail/message-inspector-query";
import type { MessageListItem } from "#/lib/mail";

export const MessageInspectorPanel = ({
  deliveryEnabled,
  mailboxId,
  message,
  open,
  onOpenChange,
}: {
  deliveryEnabled: boolean;
  mailboxId: string;
  message: MessageListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const {
    data: inspector,
    error: inspectorError,
    isError: isInspectorError,
    isPending: isInspectorPending,
  } = useQuery(getMessageInspectorOptions(mailboxId, message.id, open));
  const payloadText =
    inspector?.payload === undefined
      ? ""
      : JSON.stringify(inspector.payload, null, 2);
  let inspectorBody: ReactNode = null;

  if (isInspectorPending) {
    inspectorBody = (
      <div className="flex items-center gap-2 text-body text-muted-fg">
        <HugeiconsIcon
          aria-hidden
          className="animate-spin"
          icon={Loading03Icon}
        />
        <span>Loading message details…</span>
      </div>
    );
  } else if (isInspectorError) {
    inspectorBody = (
      <p className="text-body text-destructive">
        {inspectorError.message ?? "Could not load message details."}
      </p>
    );
  } else if (inspector !== undefined) {
    inspectorBody = (
      <>
        <section className="space-y-2">
          <h3 className="text-body font-semibold text-fg">Summary</h3>
          {[
            { label: "Reference", value: inspector.messageHeaderId },
            { label: "Subject", value: inspector.subject },
            { label: "Date", value: inspector.date },
            { label: "Snippet", value: inspector.snippet },
          ].flatMap((row) =>
            (row.value?.trim() ?? "") === ""
              ? []
              : [
                  <p className="text-body text-fg" key={row.label}>
                    <span className="font-semibold text-fg">{row.label}: </span>
                    <span className="wrap-break-word">{row.value}</span>
                  </p>,
                ]
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-body font-semibold text-fg">Message headers</h3>
          {inspector.headers.map((header) => (
            <p
              className="text-body text-fg"
              key={`${inspector.messageHeaderId}-${header.name}-${header.value}`}
            >
              <span className="font-semibold text-fg">{header.name}: </span>
              <span className="wrap-break-word">{header.value}</span>
            </p>
          ))}
        </section>

        {(inspector.rawText?.trim() ?? "") !== "" && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold text-fg">
              Original message
            </h3>
            <pre className="overflow-x-auto text-body whitespace-pre-wrap text-fg">
              {inspector.rawText}
            </pre>
          </section>
        )}

        {(inspector.raw?.trim() ?? "") !== "" && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold text-fg">Gmail record</h3>
            <pre className="overflow-x-auto text-body break-all whitespace-pre-wrap text-fg">
              {inspector.raw}
            </pre>
          </section>
        )}

        {payloadText !== "" && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold text-fg">
              Message structure
            </h3>
            <pre className="overflow-x-auto text-body whitespace-pre-wrap text-fg">
              {payloadText}
            </pre>
          </section>
        )}
      </>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(92vw,56rem)]">
        <DialogHeader>
          <DialogTitle className="text-body-lg font-bold">
            Full details
          </DialogTitle>
          <DialogDescription className="text-fg">
            Complete information available for this message.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          <MessageDeliverySection
            enabled={deliveryEnabled && open}
            mailboxId={mailboxId}
            messageId={message.id}
          />
          {inspectorBody}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton>Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type ApiSourceActionProps = {
  apiSource: MessageListItem["apiSource"];
  isPending: boolean;
  onCreateMailbox: () => void;
};

export const ApiSourceAction = ({
  apiSource,
  isPending,
  onCreateMailbox,
}: ApiSourceActionProps) => {
  if (apiSource === null || apiSource === undefined) {
    return null;
  }
  if (apiSource.canCreateMailbox) {
    return (
      <Button
        disabled={isPending}
        onClick={onCreateMailbox}
        size="sm"
        type="button"
        variant="outline"
      >
        {isPending && (
          <HugeiconsIcon
            aria-hidden
            className="size-3.5 animate-spin"
            icon={Loading03Icon}
          />
        )}
        Create mailbox
      </Button>
    );
  }
  if (
    apiSource.senderMailboxId !== null &&
    apiSource.senderMailboxId !== undefined &&
    apiSource.senderMailboxId !== ""
  ) {
    return (
      <span className="squircle rounded-md bg-muted px-2 py-1 text-caption text-muted-fg">
        {apiSource.includedInMailbox
          ? "Included in mailbox"
          : "Mailbox copy disabled"}
      </span>
    );
  }
  return null;
};
