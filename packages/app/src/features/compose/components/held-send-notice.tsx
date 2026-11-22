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

export const HeldSendNotice = ({
  held,
}: {
  held: HeldSend | null | undefined;
}) => {
  const undoUntil =
    held?.status === "held" && held.undoUntil !== null
      ? Date.parse(held.undoUntil)
      : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect((): (() => void) | undefined => {
    if (undoUntil === null) {
      return undefined;
    }
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

  if (held === undefined || held === null) {
    return (
      <Text as="div" aria-live="polite" size="sm" tone="muted">
        {held === null
          ? "This send could not be found. Use Check delivery to return to your draft."
          : "Checking on your message…"}
      </Text>
    );
  }
  const remaining =
    undoUntil === null || held.errorMessage !== null
      ? 0
      : Math.ceil((undoUntil - now) / 1000);
  return (
    <Text as="div" aria-live="polite" size="sm" tone="muted">
      {remaining > 0 ? (
        <>
          <span aria-hidden="true">{`Sending in ${remaining}s.`}</span>
          <span className="sr-only">Sending soon. You can still undo.</span>
        </>
      ) : (
        (held.errorMessage ?? heldMessages[held.status])
      )}
    </Text>
  );
};
