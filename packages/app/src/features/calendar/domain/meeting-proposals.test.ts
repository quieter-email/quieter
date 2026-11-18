import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  activateMeetingProposals,
  meetingProposalStore,
  rememberMeetingProposal,
  revokeMeetingProposals,
} from "./meeting-proposals";
import type { MeetingProposal } from "./meeting-proposals";

const proposal: MeetingProposal = {
  availability: {
    calendars: [{ calendarId: "personal", connectionId: "owned" }],
    end: "2027-01-11T17:00:00Z",
    limit: 10,
    preferences: {
      bufferAfterMinutes: 0,
      bufferBeforeMinutes: 0,
      durationMinutes: 30,
      stepMinutes: 15,
      workingHours: [{ endMinute: 1020, startMinute: 540, weekday: 1 }],
    },
    start: "2027-01-11T09:00:00Z",
    timeZone: "UTC",
  },
  calendars: [],
  id: "proposal-a",
  operationId: "operation-a",
  slots: [],
  target: {
    localId: "draft-a",
    mailboxId: "mailbox-a",
    recipients: { bcc: "", cc: "", to: "recipient@example.test" },
    replyContext: { references: [], threadId: "thread-a" },
    senderEmail: "owner@example.test",
    sourceMessageId: "message-a",
  },
  title: "Planning",
  userId: "owner-a",
};

describe("meeting proposal session isolation", () => {
  afterEach(() => {
    meetingProposalStore.setState(() => ({ proposals: [], userId: null }));
  });

  test("changing actors clears prior proposals and rejects a late prior-actor write", () => {
    activateMeetingProposals("owner-a");
    rememberMeetingProposal(proposal);
    activateMeetingProposals("owner-b");
    rememberMeetingProposal(proposal);
    expect(meetingProposalStore.state.proposals).toHaveLength(0);
    rememberMeetingProposal({
      ...proposal,
      id: "proposal-b",
      userId: "owner-b",
    });
    expect(
      meetingProposalStore.state.proposals.map((entry) => entry.userId)
    ).toStrictEqual(["owner-b"]);
  });

  test("replaces only the same mailbox draft and preserves proposals from other mailbox scopes", () => {
    activateMeetingProposals("owner-a");
    rememberMeetingProposal(proposal);
    rememberMeetingProposal({
      ...proposal,
      id: "other-mailbox",
      target: { ...proposal.target, mailboxId: "mailbox-b" },
    });
    rememberMeetingProposal({ ...proposal, id: "replacement" });
    expect(
      meetingProposalStore.state.proposals.map((entry) => entry.id)
    ).toStrictEqual(["replacement", "other-mailbox"]);
  });

  test("session teardown clears its actor and cannot clear a newer actor's proposals", () => {
    activateMeetingProposals("owner-a");
    rememberMeetingProposal(proposal);
    revokeMeetingProposals("owner-a");
    expect(meetingProposalStore.state.proposals).toHaveLength(0);
    activateMeetingProposals("owner-b");
    rememberMeetingProposal({ ...proposal, userId: "owner-b" });
    revokeMeetingProposals("owner-a");
    expect(meetingProposalStore.state.proposals).toHaveLength(1);
  });
});
