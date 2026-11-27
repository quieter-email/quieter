import type { RouterOutputs } from "@quieter/orpc";

export type ScheduledMessage = Pick<
  RouterOutputs["scheduledSends"]["list"][number],
  | "id"
  | "subject"
  | "to"
  | "sendAt"
  | "timeZone"
  | "status"
  | "errorMessage"
  | "deliveryKind"
  | "canUndo"
>;

export const getDemoScheduledMessages = (): ScheduledMessage[] => {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextWeek = new Date(tomorrow);
  nextWeek.setDate(nextWeek.getDate() + 7);
  return [
    {
      canUndo: false,
      deliveryKind: "scheduled",
      errorMessage: null,
      id: "demo-scheduled-proposal",
      sendAt: tomorrow.toISOString(),
      status: "scheduled",
      subject: "A few thoughts on the proposal",
      timeZone,
      to: "Alex <alex@example.com>",
    },
    {
      canUndo: false,
      deliveryKind: "scheduled",
      errorMessage: null,
      id: "demo-scheduled-check-in",
      sendAt: nextWeek.toISOString(),
      status: "scheduled",
      subject: "Checking in next week",
      timeZone,
      to: "Sam <sam@example.com>",
    },
  ];
};
