import { describe, expect, test } from "vite-plus/test";

import { mailInputSchemas } from "../src/mail/inputs";

describe("mail label changes", () => {
  test.each([
    { addLabelIds: [], removeLabelIds: ["INBOX"] },
    { addLabelIds: [], removeLabelIds: ["SPAM"] },
    { addLabelIds: [], removeLabelIds: ["TRASH"] },
    { addLabelIds: ["custom"], removeLabelIds: ["INBOX"] },
    { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX", "SPAM"] },
    { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX", "TRASH"] },
  ])(
    "rejects removing folder membership without a destination %#",
    (changes) => {
      const input = {
        ...changes,
        mailboxId: "mailbox",
        messageId: "message",
        threadId: "thread",
      };
      expect(
        mailInputSchemas.updateMessageLabels.safeParse(input).success
      ).toBeFalsy();
      expect(
        mailInputSchemas.updateThreadLabels.safeParse(input).success
      ).toBeFalsy();
      expect(
        mailInputSchemas.applyChanges.safeParse({
          command: {
            addIds: changes.addLabelIds,
            kind: "set-labels",
            removeIds: changes.removeLabelIds,
          },
          mailboxId: "mailbox",
          targets: [{ messageIds: ["message"], threadId: "thread" }],
        }).success
      ).toBeFalsy();
    }
  );

  test.each([
    { addLabelIds: ["custom"], removeLabelIds: ["other-custom"] },
    { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX", "SPAM"] },
    { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM", "TRASH"] },
    { addLabelIds: [], removeLabelIds: ["UNREAD"] },
  ])(
    "accepts label edits and moves with an explicit destination %#",
    (changes) => {
      const input = {
        ...changes,
        mailboxId: "mailbox",
        messageId: "message",
        threadId: "thread",
      };
      expect(
        mailInputSchemas.updateMessageLabels.safeParse(input).success
      ).toBeTruthy();
      expect(
        mailInputSchemas.updateThreadLabels.safeParse(input).success
      ).toBeTruthy();
      expect(
        mailInputSchemas.applyChanges.safeParse({
          command: {
            addIds: changes.addLabelIds,
            kind: "set-labels",
            removeIds: changes.removeLabelIds,
          },
          mailboxId: "mailbox",
          targets: [{ messageIds: ["message"], threadId: "thread" }],
        }).success
      ).toBeTruthy();
    }
  );
});
