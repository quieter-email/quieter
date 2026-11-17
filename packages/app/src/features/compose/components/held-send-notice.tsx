import type { RouterOutputs } from "@quieter/orpc";
import { Text } from "@quieter/ui/text";

type HeldSend = NonNullable<RouterOutputs["mail"]["getHeldSend"]>;

const heldMessages = {
  accepted: "Message sent. Check delivery to close this draft.",
  canceled: "Sending canceled. Return to your draft to continue editing.",
  dispatching: "Sending your message. The Undo window has ended.",
  failed: "Sending failed. Return to your draft to try again.",
  held: "Message held. Undo send is available for a few seconds.",
  preparing:
    "Preparing your message. Its Undo window starts when preparation finishes.",
  uncertain:
    "Delivery is being confirmed. Check Sent before sending another copy.",
} satisfies Record<HeldSend["status"], string>;

export const HeldSendNotice = ({
  held,
}: {
  held: HeldSend | null | undefined;
}) => (
  <div aria-live="polite" className="px-4 py-2">
    <Text size="sm" tone="muted">
      {held === null || held === undefined
        ? "Checking your send attempt. Use Check delivery to recover it."
        : (held.errorMessage ?? heldMessages[held.status])}
    </Text>
  </div>
);
