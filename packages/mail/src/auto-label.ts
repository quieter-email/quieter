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
  senders: z
    .array(z.string().trim().toLowerCase().max(254).pipe(z.email()))
    .max(30),
});

export type AutoLabelSettings = z.infer<typeof autoLabelSettingsSchema>;

export const partitionAutoLabelCandidates = <
  Label extends {
    autoLabel?: AutoLabelSettings | null;
    id: string;
  },
>(
  labels: Label[],
  message: {
    bodyHtml?: string | null;
    bodyText?: string | null;
    from?: string | null;
    snippet?: string | null;
    subject?: string | null;
  }
): { aiLabels: Label[]; deterministicLabelIds: string[] } => {
  const deterministicLabelIds: string[] = [];
  const aiLabels: Label[] = [];
  const from = message.from?.trim() ?? "";
  const angleAddress = /^[^<>]*<(?<address>[^<>]+)>$/u.exec(from)?.groups
    ?.address;
  const parsedSender = z.email().safeParse(angleAddress ?? from);
  const sender = parsedSender.success ? parsedSender.data.toLowerCase() : null;
  const domain = sender?.slice(sender.lastIndexOf("@") + 1);
  const body = message.bodyText ?? message.bodyHtml ?? message.snippet ?? "";

  for (const label of labels) {
    const settings = label.autoLabel;
    if (settings?.enabled === false) {
      continue;
    }
    if (!settings) {
      aiLabels.push(label);
      continue;
    }
    const matches: boolean[] = [];
    if (settings.senders.length > 0) {
      matches.push(sender !== null && settings.senders.includes(sender));
    }
    if (settings.domains.length > 0) {
      matches.push(
        domain !== undefined &&
          settings.domains.some((pattern) =>
            pattern.startsWith("*.")
              ? domain.endsWith(pattern.slice(1))
              : domain === pattern
          )
      );
    }
    if (settings.keywords.length > 0) {
      let text = `${message.subject ?? ""}\n${body}`;
      if (settings.keywordScope === "subject") {
        text = message.subject ?? "";
      } else if (settings.keywordScope === "body") {
        text = body;
      }
      text = text.toLowerCase();
      matches.push(
        settings.keywords.some((keyword) =>
          text.includes(keyword.toLowerCase())
        )
      );
    }
    if (
      matches.length > 0 &&
      !(settings.matchMode === "all"
        ? matches.every(Boolean)
        : matches.some(Boolean))
    ) {
      continue;
    }
    if (matches.length > 0 && settings.prompt.length === 0) {
      deterministicLabelIds.push(label.id);
    } else {
      aiLabels.push(label);
    }
  }
  return { aiLabels, deterministicLabelIds };
};
