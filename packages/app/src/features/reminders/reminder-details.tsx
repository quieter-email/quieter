"use client";

import type { Reminder } from "@quieter/mail/reminders";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";

import { ReminderMailContext } from "./reminder-mail-context";

export const ReminderDetails = ({
  reminder,
  onClose,
  onEdit,
}: {
  reminder: Reminder | null;
  onClose: () => void;
  onEdit: (reminder: Reminder) => void;
}) => (
  <Dialog
    open={reminder !== null}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <DialogContent>
      {reminder ? (
        <>
          <DialogHeader>
            <DialogTitle>{reminder.title}</DialogTitle>
          </DialogHeader>
          <DialogBody spacing="4">
            <p className="text-body-sm">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "full",
                timeStyle: "long",
                timeZone: reminder.timeZone,
              }).format(new Date(reminder.dueAt))}
              <br />
              <span className="text-caption text-muted-fg">
                {reminder.timeZone}
              </span>
            </p>
            {reminder.target.kind === "thread" ? (
              <ReminderMailContext
                layout="summary"
                mailboxId={reminder.mailboxId}
                target={reminder.target}
              />
            ) : null}
            {reminder.target.kind === "thread" && reminder.target.condition ? (
              <div className="space-y-1">
                <p className="text-caption text-muted-fg">Complete when</p>
                <p className="text-body-sm">{reminder.target.condition}</p>
              </div>
            ) : null}
            {reminder.source ? (
              <div className="space-y-1">
                <p className="text-caption text-muted-fg">
                  {reminder.source.kind === "automatic"
                    ? "Added automatically"
                    : "From a suggestion"}
                </p>
                <p className="text-body-sm">{reminder.source.reason}</p>
              </div>
            ) : null}
            {reminder.evaluationStatus === "pending" ? (
              <p className="text-body-sm text-muted-fg">Checking replies...</p>
            ) : null}
            {reminder.evaluationSummary ? (
              <p className="text-body-sm">{reminder.evaluationSummary}</p>
            ) : null}
            {reminder.status === "suspended" ? (
              <p className="text-body-sm text-muted-fg">
                Paused because mailbox access is unavailable.
              </p>
            ) : null}
            {reminder.status === "completed" ? (
              <p className="text-body-sm text-muted-fg">
                {reminder.resolution === "fulfilled"
                  ? "Completed because the reply condition was met."
                  : "Completed by you."}
              </p>
            ) : null}
            {reminder.status === "cancelled" ? (
              <p className="text-body-sm text-muted-fg">Cancelled by you.</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose} variant="secondary">
              Close
            </Button>
            <Button
              onClick={() => {
                onEdit(reminder);
              }}
            >
              Edit reminder
            </Button>
          </DialogFooter>
        </>
      ) : null}
    </DialogContent>
  </Dialog>
);
