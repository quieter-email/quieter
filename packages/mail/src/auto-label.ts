import { z } from "zod";

const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export const autoLabelSettingsSchema = z.object({
  domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .max(255)
        .refine((value) => {
          const domain = value.startsWith("*.") ? value.slice(2) : value;
          return domain.length <= 253 && domainPattern.test(domain);
        }, "Enter a domain such as example.com or *.example.com.")
    )
    .max(30),
  enabled: z.boolean(),
  keywordScope: z.enum(["anywhere", "subject", "body"]),
  keywords: z.array(z.string().trim().min(1).max(200)).max(30),
  matchMode: z.enum(["all", "any"]),
  prompt: z.string().trim().max(4000),
  recipients: z
    .array(z.string().trim().toLowerCase().max(254).pipe(z.email()))
    .max(30)
    .optional(),
  senders: z
    .array(z.string().trim().toLowerCase().max(254).pipe(z.email()))
    .max(30),
});

export type AutoLabelSettings = z.infer<typeof autoLabelSettingsSchema>;

export type MailAutoLabelHistoryExample = {
  messageId: string;
  sender: string;
  subject?: string;
  date?: string;
  currentLabels: {
    id: string;
    name: string;
    source?: "manual" | "rule" | "inherited" | "backfill" | "ai_auto_label";
  }[];
  priorAutomaticApplication: {
    appliedAt: string;
    labels: { id: string; name: string }[];
  } | null;
  manualCorrections: {
    labelId: string;
    labelName: string;
    signal: "added" | "removed";
    recordedAt: string;
  }[];
};

export type MailAutoLabelHistory = {
  sameSender: MailAutoLabelHistoryExample[];
  sameDomain: MailAutoLabelHistoryExample[];
};
