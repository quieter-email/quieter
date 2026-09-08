import { ORPCError } from "@orpc/server";
import {
  createLabel,
  deleteLabel,
  listLabels,
  updateLabel,
} from "@quieter/gmail";

import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  createManagedLabel,
  deleteManagedLabel,
  listManagedLabels,
  updateManagedLabel,
} from "../managed-mail/labels/service";
import type { MailInputs } from "./inputs";

export const labelsMailOperations = {
  createLabel: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["createLabel"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await createManagedLabel({
        color: input.color ?? "gray",
        description: input.description,
        mailboxId: input.mailboxId,
        name: input.name,
        userId: context.userId,
      });
    }
    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const { upsertSyncedGmailLabel } = await import("../gmail-labels");
        const label = await upsertSyncedGmailLabel(
          input.mailboxId,
          await createLabel(accessToken, input.name, signal),
          input.color
        );
        return {
          ...label,
          color: label.color,
          position: 0,
          provider: "gmail" as const,
          visible: true,
        };
      }
    );
  },
  deleteLabel: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["deleteLabel"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await deleteManagedLabel({
        labelId: input.labelId,
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
    }
    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const result = await deleteLabel(accessToken, input.labelId, signal);
        const { deleteSyncedGmailLabel } = await import("../gmail-labels");
        await deleteSyncedGmailLabel(input.mailboxId, input.labelId);
        return result;
      }
    );
  },
  listLabels: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["listLabels"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await listManagedLabels({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const { syncGmailLabels } = await import("../gmail-labels");
        const labels = await syncGmailLabels(
          input.mailboxId,
          await listLabels(accessToken, signal)
        );
        return labels.map((label, position) => ({
          ...label,
          color: label.color,
          position,
          provider: "gmail" as const,
          visible: true,
        }));
      }
    );
  },
  updateLabel: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["updateLabel"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await updateManagedLabel({
        color: input.color,
        description: input.description,
        labelId: input.labelId,
        mailboxId: input.mailboxId,
        name: input.name,
        position: input.position,
        userId: context.userId,
        visible: input.visible,
      });
    }
    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const { upsertSyncedGmailLabel } = await import("../gmail-labels");
        const label = await upsertSyncedGmailLabel(
          input.mailboxId,
          await updateLabel(accessToken, input.labelId, input.name, signal),
          input.color
        );
        return {
          ...label,
          color: label.color,
          position: 0,
          provider: "gmail" as const,
          visible: true,
        };
      }
    );
  },
  updateLabelDetails: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["updateLabelDetails"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await updateManagedLabel({
        description: input.description,
        labelId: input.labelId,
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
    }
    const { saveGmailLabelDetails } = await import("../gmail-labels");
    const updatedLabel = await saveGmailLabelDetails(input);
    if (updatedLabel === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Label not found." });
    }
    return updatedLabel;
  },
};
