"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { MessageDeliverySection } from "@quieter/app/features/message-delivery/components/message-delivery-section";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { getMessageInspectorOptions } from "@quieter/app/lib/mail/message-inspector-query";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@quieter/ui/accordion";
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
import { Icon } from "@quieter/ui/icon";
import { Pill } from "@quieter/ui/pill";
import { Text } from "@quieter/ui/text";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

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
        <Icon aria-hidden animation="spin" icon={Loading03Icon} />
        <span>Loading message details…</span>
      </div>
    );
  } else if (isInspectorError) {
    inspectorBody = (
      <Text tone="destructive">
        {inspectorError.message ?? "Could not load message details."}
      </Text>
    );
  } else if (inspector !== undefined) {
    inspectorBody = (
      <>
        <section className="space-y-3">
          <Text as="h3" weight="medium">
            Message
          </Text>
          <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-body">
            {[
              { label: "From", value: inspector.from },
              { label: "To", value: inspector.to },
              { label: "Cc", value: inspector.cc },
              { label: "Bcc", value: inspector.bcc },
              { label: "Reply-to", value: inspector.replyTo },
              { label: "Date", value: inspector.date },
            ].map((row) =>
              (row.value?.trim() ?? "") === "" ? null : (
                <div className="contents" key={`${row.label}-${row.value}`}>
                  <dt className="text-muted-fg">{row.label}</dt>
                  <dd className="min-w-0 wrap-break-word text-fg">
                    {row.value}
                  </dd>
                </div>
              )
            )}
          </dl>
        </section>

        <Accordion>
          <AccordionItem value="technical-details">
            <AccordionHeader>
              <AccordionTrigger>Technical details</AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel>
              <div className="space-y-4">
                <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-body">
                  {[
                    { label: "Reference", value: inspector.messageHeaderId },
                    { label: "Subject", value: inspector.subject },
                    { label: "Snippet", value: inspector.snippet },
                  ].map((row) =>
                    (row.value?.trim() ?? "") === "" ? null : (
                      <div className="contents" key={row.label}>
                        <dt className="text-muted-fg">{row.label}</dt>
                        <dd className="min-w-0 wrap-break-word text-fg">
                          {row.value}
                        </dd>
                      </div>
                    )
                  )}
                </dl>
                <section className="space-y-2">
                  <Text as="h3" weight="medium">
                    Message headers
                  </Text>
                  {inspector.headers.map((header) => (
                    <p
                      className="text-body text-fg"
                      key={`${inspector.messageHeaderId}-${header.name}-${header.value}`}
                    >
                      <span className="font-medium text-fg">
                        {header.name}:{" "}
                      </span>
                      <span className="wrap-break-word">{header.value}</span>
                    </p>
                  ))}
                </section>

                {(inspector.rawText?.trim() ?? "") !== "" && (
                  <section className="space-y-2">
                    <h3 className="text-body font-medium text-fg">
                      Original message
                    </h3>
                    <pre className="overflow-x-auto text-body whitespace-pre-wrap text-fg">
                      {inspector.rawText}
                    </pre>
                  </section>
                )}

                {(inspector.raw?.trim() ?? "") !== "" && (
                  <section className="space-y-2">
                    <h3 className="text-body font-medium text-fg">
                      Source record
                    </h3>
                    <pre className="overflow-x-auto text-body break-all whitespace-pre-wrap text-fg">
                      {inspector.raw}
                    </pre>
                  </section>
                )}

                {payloadText !== "" && (
                  <section className="space-y-2">
                    <h3 className="text-body font-medium text-fg">
                      Message structure
                    </h3>
                    <pre className="overflow-x-auto text-body whitespace-pre-wrap text-fg">
                      {payloadText}
                    </pre>
                  </section>
                )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(92vw,36rem)]">
        <DialogHeader>
          <DialogTitle>Message details</DialogTitle>
          <DialogDescription>
            {inspector?.subject ||
              message.subject ||
              "Message activity and delivery details."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] overflow-y-auto" spacing="5">
          <MessageDeliverySection
            enabled={deliveryEnabled && open}
            mailboxId={mailboxId}
            messageId={message.id}
          />
          {inspectorBody}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton variant="default">Close</DialogCloseButton>
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
        chrome="toolbar"
        disabled={isPending}
        onClick={onCreateMailbox}
        size="sm"
        type="button"
        variant="outline"
      >
        {isPending && (
          <Icon aria-hidden size={14} animation="spin" icon={Loading03Icon} />
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
      <Pill size="xs" tone="neutral">
        {apiSource.includedInMailbox
          ? "Included in mailbox"
          : "Mailbox copy disabled"}
      </Pill>
    );
  }
  return null;
};
