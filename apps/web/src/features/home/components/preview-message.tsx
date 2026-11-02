"use client";

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
import { Text } from "@quieter/ui/text";

import type { PreviewMessage } from "./preview-data";

export const PreviewMessageBody = ({
  message,
}: {
  message: PreviewMessage;
}) => (
  <div className="flex flex-col gap-4">
    <div>
      <Text size="body" weight="medium">
        {message.sender}
      </Text>
      <Text size="caption" tone="muted">
        {message.address}
      </Text>
    </div>
    <Text size="body">{message.body}</Text>
  </div>
);

export const PreviewMessageDialog = ({
  message,
  onClose,
}: {
  message: PreviewMessage | null;
  onClose: () => void;
}) => (
  <Dialog
    open={message !== null}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{message?.subject}</DialogTitle>
        <DialogDescription>Sample email</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {message ? <PreviewMessageBody message={message} /> : null}
      </DialogBody>
      <DialogFooter>
        <DialogCloseButton variant="default">Close</DialogCloseButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
