import { z } from "zod";

import { mailUndoOriginalSchema } from "./undo-model";

export const snoozePlacementAcknowledgementSchema = z
  .strictObject({
    kind: z.literal("snooze-placement-ack"),
    original: mailUndoOriginalSchema,
  })
  .transform((acknowledgement, context) => {
    const { original } = acknowledgement;
    if (
      original.kind !== "placement" ||
      original.proof === null ||
      original.proof.effects.some(
        (effect) => effect.outcome.status !== "acknowledged"
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "A Snooze phase requires acknowledged placement evidence.",
      });
      return z.NEVER;
    }
    return { kind: acknowledgement.kind, original };
  });
