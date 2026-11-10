import { rpc } from "@quieter/app/lib/orpc";

import { scheduleComposeMessage } from "./draft";
import type { ComposeDraftState } from "./draft";

type ScheduledMessage = Awaited<ReturnType<typeof rpc.scheduledSends.create>>;

export type ComposeScheduleRecovery =
  | { status: "scheduled"; scheduled: ScheduledMessage }
  | { status: "editable"; draft: ComposeDraftState };

export const recoverComposeSchedule = async ({
  mailboxId,
  draft,
}: {
  mailboxId: string;
  draft: ComposeDraftState;
}): Promise<ComposeScheduleRecovery> => {
  if (!draft.sendOperationId || !draft.scheduleAttempt) {
    throw new Error("This draft has no scheduling attempt to check.");
  }
  let scheduled = await rpc.scheduledSends.getByOperation({
    mailboxId,
    sendOperationId: draft.sendOperationId,
  });
  if (scheduled !== null) {
    return { scheduled, status: "scheduled" };
  }
  let mustRecover =
    (draft.recoveryMissingFiles?.length ?? 0) > 0 ||
    new Date(draft.scheduleAttempt.sendAt).getTime() < Date.now() + 60_000;
  if (!mustRecover) {
    try {
      scheduled = await scheduleComposeMessage(
        mailboxId,
        draft,
        draft.scheduleAttempt
      );
      return { scheduled, status: "scheduled" };
    } catch (error) {
      const data: unknown =
        typeof error === "object" && error !== null && "data" in error
          ? error.data
          : undefined;
      mustRecover =
        typeof data === "object" &&
        data !== null &&
        (("scheduledTimeInvalid" in data &&
          data.scheduledTimeInvalid === true) ||
          ("scheduleAttemptAbandoned" in data &&
            data.scheduleAttemptAbandoned === true));
      if (!mustRecover) {
        throw error;
      }
    }
  }
  const recovery = await rpc.scheduledSends.recoverAttempt({
    mailboxId,
    sendOperationId: draft.sendOperationId,
  });
  if (recovery.status === "scheduled") {
    return recovery;
  }
  const missingFiles = draft.recoveryMissingFiles ?? [];
  return {
    draft: {
      ...draft,
      errorMessage:
        missingFiles.length > 0
          ? `This message was not scheduled. Reattach these files before scheduling: ${missingFiles.join(", ")}.`
          : "This message was not scheduled. Choose a new send time or send it now.",
      saveStatus: "error",
      scheduleAttempt: undefined,
      sendOperationId: crypto.randomUUID(),
      sendUncertain: false,
    },
    status: "editable",
  };
};
