import type { MailboxLabel } from "@quieter/mail/mailbox-organization";

export const getAutoLabelPrompt = (label: MailboxLabel): string => {
  const settings = label.autoLabel;
  if (!settings) {
    return label.inclusionCriteria ?? "";
  }

  const conditions: string[] = [];
  if (settings.senders.length > 0) {
    conditions.push(
      `the sender address exactly matches ${settings.senders.join(" or ")}`
    );
  }
  if (settings.recipients && settings.recipients.length > 0) {
    conditions.push(
      `a recipient address in To, Cc, or Bcc exactly matches ${settings.recipients.join(" or ")}`
    );
  }
  if (settings.domains.length > 0) {
    const domains = settings.domains.map((domain) =>
      domain.startsWith("*.")
        ? `a subdomain of ${domain.slice(2)}, excluding ${domain.slice(2)} itself`
        : `exactly ${domain}`
    );
    conditions.push(`the sender domain is ${domains.join(" or ")}`);
  }
  if (settings.keywords.length > 0) {
    const scope = {
      anywhere: "subject or body",
      body: "body",
      subject: "subject",
    }[settings.keywordScope];
    conditions.push(
      `the ${scope} contains ${settings.keywords.map((keyword) => JSON.stringify(keyword)).join(" or ")}, ignoring case`
    );
  }
  if (conditions.length === 0) {
    return settings.prompt;
  }

  const matching =
    settings.matchMode === "all"
      ? "all of these conditions match"
      : "at least one of these conditions matches";
  const prompt =
    conditions.length === 1
      ? `Label emails where ${conditions[0]}.`
      : `Apply this label when ${matching}:\n${conditions.map((condition) => `- ${condition}`).join("\n")}`;
  return settings.prompt.trim()
    ? `${prompt}\n\nAlso follow these instructions:\n${settings.prompt}`
    : prompt;
};
