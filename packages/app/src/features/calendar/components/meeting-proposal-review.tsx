"use client";

import { applyCalendarMutationReceipt } from "@quieter/app/lib/calendar-cache-lifecycle";
import { toastError } from "@quieter/app/lib/error-toast";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { rpc } from "@quieter/app/lib/orpc";
import type { CalendarEvent, CalendarSummary } from "@quieter/calendar";
import type { RouterInputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Text } from "@quieter/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { useEffect, useMemo, useRef } from "react";

import { createCalendarEventEditorStore } from "../domain/calendar-event-editor";
import type { CalendarEditor } from "../domain/calendar-event-form";
import {
  activateMeetingProposals,
  meetingProposalStore,
} from "../domain/meeting-proposals";
import type { MeetingProposal } from "../domain/meeting-proposals";
import { CalendarEventEditor } from "./calendar-event-editor";

const ProposalEventReview = ({
  calendar,
  onClose,
  proposal,
  slot,
}: {
  calendar: CalendarSummary;
  onClose: () => void;
  proposal: MeetingProposal;
  slot: MeetingProposal["slots"][number];
}) => {
  const client = useQueryClient();
  const editor = useMemo<CalendarEditor>(
    () => ({
      kind: "create",
      operationId: proposal.operationId,
      ref: {
        calendarId: calendar.calendarId,
        connectionId: calendar.connectionId,
      },
      time: { ...slot, kind: "timed" },
    }),
    [calendar.calendarId, calendar.connectionId, proposal.operationId, slot]
  );
  const store = useMemo(() => {
    const created = createCalendarEventEditorStore(editor, slot.timeZone);
    created.setState((current) => ({
      ...current,
      initialValues: { ...current.initialValues, title: proposal.title },
      values: { ...current.values, title: proposal.title },
    }));
    return created;
  }, [editor, proposal.title, slot.timeZone]);
  const create = useMutation({
    mutationFn: async (input: RouterInputs["calendar"]["createFromProposal"]) =>
      await rpc.calendar.createFromProposal(input),
    mutationKey: [
      "calendar",
      proposal.userId,
      "mailbox",
      proposal.target.mailboxId,
      "create-proposed-event",
      proposal.id,
    ],
    onError: (error) => {
      toastError(error, { boundary: "meeting-proposal-create" });
    },
    onSuccess: async (receipt) => {
      await applyCalendarMutationReceipt(client, proposal.userId, receipt);
      meetingProposalStore.setState((current) => ({
        ...current,
        proposals: current.proposals.filter(
          (entry) => entry.id !== proposal.id
        ),
      }));
      onClose();
    },
  });
  return (
    <div className="space-y-3">
      <Text as="p" size="caption" tone="muted">
        Create one event only after the time has been agreed. Access and
        availability are checked again before saving. Proposed times are not
        reservations. Guests must be explicitly reviewed below.
      </Text>
      {create.isError ? (
        <Text as="p" role="alert" size="sm">
          The event could not be confirmed. Review your calendar before retrying
          if a previous request may have succeeded.
        </Text>
      ) : null}
      <CalendarEventEditor
        calendars={proposal.calendars}
        editor={editor}
        events={[]}
        onClose={onClose}
        onReload={async (event) =>
          await rpc.calendar.event({
            calendarId: event.calendarId,
            connectionId: event.connectionId,
            eventId: event.eventId,
          })
        }
        onSave={async ({ draft, ref }): Promise<CalendarEvent | undefined> => {
          let saved: CalendarEvent | undefined;
          if (draft.time.kind === "timed") {
            try {
              const receipt = await create.mutateAsync({
                ...ref,
                availability: proposal.availability,
                event: { ...draft, time: draft.time },
                mailboxId: proposal.target.mailboxId,
                operationId: proposal.operationId,
              });
              saved = receipt.event;
            } catch {
              saved = undefined;
            }
          } else {
            toastError({
              message: "Choose a timed, one-off meeting for a proposed time.",
              status: 400,
            });
          }
          return saved;
        }}
        pending={create.isPending}
        preview={false}
        store={store}
        timeZone={slot.timeZone}
        userId={proposal.userId}
      />
    </div>
  );
};

export const MeetingProposalReview = ({ userId }: { userId: string }) => {
  const proposals = useSelector(meetingProposalStore, (state) =>
    state.userId === userId ? state.proposals : []
  );
  const store = useCreateStore<{
    access: "unverified" | "checking" | "ready" | "failed";
    open: boolean;
    selection: { id: string; start: string } | null;
  }>({ access: "unverified", open: false, selection: null });
  const { access, open, selection } = useSelector(store, (current) => current);
  const accessRequest = useRef(0);
  const mailboxes = useQuery(mailboxesQueryOptions(proposals.length > 0));
  const visible = proposals.filter(
    (proposal) =>
      access === "ready" &&
      mailboxes.data?.groups.some((group) =>
        group.mailboxes.some(
          (mailbox) => mailbox.id === proposal.target.mailboxId
        )
      ) === true
  );
  useEffect(() => {
    activateMeetingProposals(userId);
    accessRequest.current += 1;
    store.setState(() => ({
      access: "unverified",
      open: false,
      selection: null,
    }));
  }, [store, userId]);
  useEffect(() => {
    if (mailboxes.isSuccess) {
      const allowed = new Set(
        mailboxes.data.groups.flatMap((group) =>
          group.mailboxes.map((mailbox) => mailbox.id)
        )
      );
      meetingProposalStore.setState((current) => ({
        ...current,
        proposals: current.proposals.filter(
          (proposal) =>
            proposal.userId !== userId || allowed.has(proposal.target.mailboxId)
        ),
      }));
    }
  }, [mailboxes.data, mailboxes.isSuccess, userId]);
  const { error: mailboxError } = mailboxes;
  useEffect(() => {
    if (
      mailboxError &&
      "status" in mailboxError &&
      (mailboxError.status === 401 || mailboxError.status === 403)
    ) {
      accessRequest.current += 1;
      store.setState((current) => ({ ...current, access: "failed" }));
      meetingProposalStore.setState((current) => ({
        ...current,
        proposals: current.proposals.filter((entry) => entry.userId !== userId),
      }));
    }
  }, [mailboxError, store, userId]);
  const proposal = visible.find((entry) => entry.id === selection?.id);
  const slot = proposal?.slots.find(
    (entry) => entry.start === selection?.start
  );
  const calendar = proposal?.calendars.find(
    (entry) => entry.access === "owner" || entry.access === "write"
  );
  const openReview = async () => {
    accessRequest.current += 1;
    const request = accessRequest.current;
    store.setState(() => ({ access: "checking", open: true, selection: null }));
    try {
      await mailboxes.refetch({ throwOnError: true });
      if (request === accessRequest.current) {
        store.setState((current) => ({ ...current, access: "ready" }));
      }
    } catch (error) {
      if (request === accessRequest.current) {
        store.setState((current) => ({ ...current, access: "failed" }));
        toastError(error, { boundary: "meeting-proposal-access" });
      }
    }
  };
  if (proposals.length === 0) {
    return null;
  }
  return (
    <>
      <Button
        chrome="toolbar"
        onClick={() => {
          void openReview();
        }}
        size="sm"
        type="button"
        variant="secondary"
      >
        Review proposed meetings ({proposals.length})
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (!next) {
            accessRequest.current += 1;
          }
          store.setState((current) => ({ ...current, open: next }));
        }}
        open={open}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Review a proposed meeting</DialogTitle>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
            {access === "checking" ? (
              <Text as="p" size="sm">
                Checking current mailbox access…
              </Text>
            ) : null}
            {access === "failed" ? (
              <Button
                onClick={() => {
                  void openReview();
                }}
                type="button"
                variant="secondary"
              >
                Retry mailbox access
              </Button>
            ) : null}
            <Text as="p" size="caption" tone="muted">
              Proposals stay here during this app session, including after
              sending a reply. Sending does not create an event. Inserted
              wording follows ordinary draft recovery.
            </Text>
            {proposal && !calendar ? (
              <Text as="p" role="alert" size="sm">
                An editable calendar must be included when checking availability
                before creating an event.
              </Text>
            ) : null}
            {proposal && slot && calendar ? (
              <ProposalEventReview
                calendar={calendar}
                key={`${proposal.id}-${slot.start}`}
                onClose={() => {
                  store.setState((current) => ({ ...current, open: false }));
                }}
                proposal={proposal}
                slot={slot}
              />
            ) : (
              visible.map((entry) => (
                <div className="space-y-2" key={entry.id}>
                  <Text as="p" size="sm">
                    {entry.title}, from {entry.target.senderEmail}
                  </Text>
                  {entry.slots.map((candidate) => (
                    <Button
                      key={candidate.start}
                      onClick={() => {
                        store.setState((current) => ({
                          ...current,
                          selection: { id: entry.id, start: candidate.start },
                        }));
                      }}
                      size="auto"
                      type="button"
                      variant="secondary"
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: candidate.timeZone,
                      }).format(new Date(candidate.start))}
                      , {candidate.timeZone}
                    </Button>
                  ))}
                  <Button
                    onClick={() => {
                      meetingProposalStore.setState((current) => ({
                        ...current,
                        proposals: current.proposals.filter(
                          (item) => item.id !== entry.id
                        ),
                      }));
                    }}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    Remove proposal
                  </Button>
                </div>
              ))
            )}
          </DialogBody>
          {proposal && slot && calendar ? null : (
            <DialogFooter>
              <Button
                onClick={() => {
                  store.setState((current) => ({ ...current, open: false }));
                }}
                type="button"
              >
                Close
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
