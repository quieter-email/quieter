import type { RouterOutputs } from "@quieter/orpc";
import { Text } from "@quieter/ui/text";
import { useEffect, useState } from "react";

type HeldSend = NonNullable<RouterOutputs["mail"]["getHeldSend"]>;

const heldMessages = {
  accepted: "Message sent. Check delivery to close this draft.",
  canceled: "Sending canceled. Return to your draft to keep editing.",
  dispatching: "Sending…",
  failed: "Sending failed. Return to your draft to try again.",
  held: "Sending…",
  preparing: "Preparing to send…",
  uncertain: "Confirming delivery. Check Sent before sending another copy.",
} satisfies Record<HeldSend["status"], string>;

const HeldCountdown = ({ undoUntil }: { undoUntil: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect((): (() => void) => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= undoUntil) {
        clearInterval(timer);
      }
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [undoUntil]);
  const remaining = Math.ceil((undoUntil - now) / 1000);
  if (remaining <= 0) {
    return heldMessages.held;
  }
  return (
    <>
      <span aria-hidden="true">{`Sending in ${remaining}s.`}</span>
      <span className="sr-only">Sending soon. You can still undo.</span>
    </>
  );
};

export const HeldSendNotice = ({
  held,
  isError = false,
}: {
  held: HeldSend | null | undefined;
  isError?: boolean;
}) => {
  if (isError) {
    return (
      <Text as="div" aria-live="polite" size="sm" tone="muted">
        Could not check delivery status. Use Check delivery to try again.
      </Text>
    );
  }
  if (held === undefined || held === null) {
    return (
      <Text as="div" aria-live="polite" size="sm" tone="muted">
        {held === null
          ? "This send could not be found. Use Check delivery to return to your draft."
          : "Checking on your message…"}
      </Text>
    );
  }
  const undoUntil =
    held.status === "held" &&
    held.undoUntil !== null &&
    held.errorMessage === null
      ? Date.parse(held.undoUntil)
      : null;
  const message =
    held.errorMessage ??
    (held.status === "canceled" && held.draftId === null
      ? "Sending canceled. Returning your message to Drafts…"
      : heldMessages[held.status]);
  return (
    <Text as="div" aria-live="polite" size="sm" tone="muted">
      {undoUntil === null ? (
        message
      ) : (
        <HeldCountdown key={undoUntil} undoUntil={undoUntil} />
      )}
    </Text>
  );
};
