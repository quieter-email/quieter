import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import type { CalendarSummary } from "@quieter/calendar";
import type {
  CalendarAvailabilityInput,
  CalendarAvailabilityResult,
} from "@quieter/calendar/availability";
import { createStore } from "@tanstack/react-store";

export type MeetingReplyTarget = {
  localId: string;
  mailboxId: string;
  recipients: ComposeDraftState["recipients"];
  replyContext: NonNullable<ComposeDraftState["replyContext"]>;
  senderEmail: string;
  sourceMessageId: string | null;
};
export type MeetingProposalInsertion = {
  target: MeetingReplyTarget;
  text: string;
};
export type MeetingProposal = {
  availability: CalendarAvailabilityInput;
  calendars: CalendarSummary[];
  id: string;
  operationId: string;
  slots: CalendarAvailabilityResult["candidates"];
  target: MeetingReplyTarget;
  title: string;
  userId: string;
};

export const meetingProposalStore = createStore<{
  proposals: MeetingProposal[];
  userId: string | null;
}>({ proposals: [], userId: null });

export const activateMeetingProposals = (userId: string) => {
  meetingProposalStore.setState((current) =>
    current.userId === userId ? current : { proposals: [], userId }
  );
};

export const rememberMeetingProposal = (proposal: MeetingProposal) => {
  meetingProposalStore.setState((current) => {
    if (current.userId !== proposal.userId) {
      return current;
    }
    return {
      ...current,
      proposals: [
        proposal,
        ...current.proposals.filter(
          (entry) =>
            entry.target.mailboxId !== proposal.target.mailboxId ||
            entry.target.localId !== proposal.target.localId
        ),
      ].slice(0, 10),
    };
  });
};

export const formatMeetingProposal = ({
  introduction,
  slots,
  timeZone,
}: {
  introduction: string;
  slots: CalendarAvailabilityResult["candidates"];
  timeZone: string;
}) => {
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeZone,
  });
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "shortOffset",
  });
  return [
    introduction.trim(),
    ...slots.map(
      (slot) =>
        `${date.format(new Date(slot.start))}, ${time.format(new Date(slot.start))} to ${time.format(new Date(slot.end))}`
    ),
    `Times are in ${timeZone}. These times fit my selected calendars. Your availability has not been checked. Please let me know which works for you.`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const revokeMeetingProposals = (userId: string | undefined) => {
  meetingProposalStore.setState((current) =>
    current.userId === userId ? { proposals: [], userId: null } : current
  );
};
