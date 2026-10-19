import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import { mailboxLabelSchema } from "@quieter/mail/mailbox-organization";
import { z } from "zod";

const demoLabelAutomationSchema = z.object({
  createdLabels: z.array(mailboxLabelSchema).default([]),
  deletedLabelIds: z.array(z.string()).default([]),
  enabled: z.boolean(),
  labels: z.record(z.string(), autoLabelSettingsSchema),
  updatedLabels: z.record(z.string(), mailboxLabelSchema).default({}),
});

export type DemoLabelAutomation = z.infer<typeof demoLabelAutomationSchema>;

export const getDemoLabelAutomation = (
  mailboxId: string
): DemoLabelAutomation => {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(
      `quieter:label-automation:${mailboxId}`
    );
    if (stored) {
      try {
        const parsed = demoLabelAutomationSchema.safeParse(JSON.parse(stored));
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        window.localStorage.removeItem(`quieter:label-automation:${mailboxId}`);
      }
    }
  }
  return {
    createdLabels: [],
    deletedLabelIds: [],
    enabled: false,
    labels: {},
    updatedLabels: {},
  };
};

export const saveDemoLabelAutomation = (
  mailboxId: string,
  settings: DemoLabelAutomation
) => {
  window.localStorage.setItem(
    `quieter:label-automation:${mailboxId}`,
    JSON.stringify(demoLabelAutomationSchema.parse(settings))
  );
};
