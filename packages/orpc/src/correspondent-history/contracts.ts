import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/mail/messages";
import type { Reminder } from "@quieter/mail/reminders";
import { z } from "zod";

import type { AiCorrespondentMemoryPage } from "../ai-memory-context";

export const correspondentSelectionSchema = z.strictObject({
  correspondentEmail: z.string().trim().toLowerCase().pipe(z.email()),
  mailboxId: z.string().trim().min(1).max(512),
});

export const correspondentHistoryInputSchema =
  correspondentSelectionSchema.extend({
    cursor: z.string().min(1).max(16_000).optional(),
    section: z.enum(["mail", "memory", "commitments"]),
  });

export const correspondentSourceSchema = z.strictObject({
  kind: z.literal("mail"),
  messageId: z.string().min(1).max(512),
  revision: z.string().min(1).max(1000),
  threadId: z.string().min(1).max(512),
});

export const openCorrespondentSourceSchema =
  correspondentSelectionSchema.extend({
    source: correspondentSourceSchema,
  });

const cursorScope = {
  actorId: z.string().min(1).max(512),
  correspondentEmail: z.string(),
  mailboxId: z.string().min(1).max(512),
};

export const correspondentCursorSchema = z.discriminatedUnion("section", [
  z.strictObject({
    ...cursorScope,
    position: z.string().min(1).max(10_000),
    section: z.literal("mail"),
  }),
  z.strictObject({
    ...cursorScope,
    position: z.strictObject({
      afterId: z.string().min(1).max(200),
      startedAt: z.iso.datetime(),
    }),
    section: z.literal("memory"),
  }),
  z.strictObject({
    ...cursorScope,
    position: z.string().min(1).max(200),
    section: z.literal("commitments"),
  }),
]);

export type CorrespondentSelection = z.infer<
  typeof correspondentSelectionSchema
>;
export type CorrespondentHistoryInput = z.infer<
  typeof correspondentHistoryInputSchema
>;
export type CorrespondentSource = z.infer<typeof correspondentSourceSchema>;
export type OpenCorrespondentSourceInput = z.infer<
  typeof openCorrespondentSourceSchema
>;
export type CorrespondentCursor = z.infer<typeof correspondentCursorSchema>;

export type CorrespondentHistoryPage = CorrespondentSelection & {
  nextCursor: string | null;
} & (
    | {
        items: {
          message: MessageListItem;
          source: CorrespondentSource | null;
        }[];
        section: "mail";
      }
    | {
        items: AiCorrespondentMemoryPage["items"];
        section: "memory";
      }
    | {
        items: { reminder: Reminder; source: CorrespondentSource | null }[];
        section: "commitments";
      }
  );

export type OpenedCorrespondentSource = {
  messageId: string;
  thread: ThreadMessagesResult;
};
