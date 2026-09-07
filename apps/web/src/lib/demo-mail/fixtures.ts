import { clientEnv } from "#/env";
import type { MessageListItem } from "#/lib/mail";

export const createDemoMessage = (
  id: string,
  fields: Omit<
    MessageListItem,
    "id" | "threadId" | "messageHeaderId" | "internalDate"
  > & { threadId?: string }
): MessageListItem => {
  const domain = /@(?<domain>[a-z0-9-]+(?:\.[a-z0-9-]+)+)/iu
    .exec(fields.from ?? "")
    ?.groups?.domain?.toLowerCase();
  const token = clientEnv.VITE_LOGO_DEV_PUBLISHABLE_KEY;
  return {
    ...fields,
    id,
    internalDate: fields.date ?? new Date().toISOString(),
    messageHeaderId: `<${id}@demo.quieter.local>`,
    senderAvatarUrls:
      fields.senderAvatarUrls ??
      (domain && token
        ? {
            dark: `https://img.logo.dev/${encodeURIComponent(domain)}?token=${token}&size=64&theme=dark&format=webp&fallback=404`,
            light: `https://img.logo.dev/${encodeURIComponent(domain)}?token=${token}&size=64&theme=light&format=webp&fallback=404`,
          }
        : undefined),
    threadId: fields.threadId ?? id,
  };
};
