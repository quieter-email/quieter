import type { mailboxAgentEffect } from "@quieter/database/schema";
import { z } from "zod";

const resultIdentitySchema = z.object({
  draftId: z.string().max(256).optional(),
  eventId: z.string().max(1024).optional(),
  htmlLink: z.string().max(2048).optional(),
  id: z.string().max(256).optional(),
  summary: z.string().max(512).optional(),
  title: z.string().max(512).optional(),
  url: z.string().max(2048).optional(),
  webUrl: z.string().max(2048).optional(),
});
const toolContentSchema = z.object({
  content: z.array(z.unknown()).optional(),
  event: z.unknown().optional(),
  structuredContent: z.unknown().optional(),
});
const textContentSchema = z.object({
  text: z.string(),
  type: z.literal("text"),
});
const continuationSchema = z
  .object({
    calendarId: z.string().max(1024).optional(),
    currentDate: z.iso.date().optional(),
    fetchedAt: z.iso.datetime({ offset: true }).optional(),
    nextPageToken: z.string().max(2048).optional(),
    partial: z.boolean().optional(),
    query: z.string().max(300).optional(),
    status: z.literal("success").optional(),
    timeMax: z.string().max(128).optional(),
    timeMin: z.string().max(128).optional(),
    timeZone: z.string().max(128).optional(),
  })
  .refine((value) => JSON.stringify(value).length <= 3000);

const getResultIdentity = (result: unknown) => {
  const candidates: unknown[] = [result];
  const content = toolContentSchema.safeParse(result);
  if (content.success) {
    candidates.unshift(content.data.event);
    candidates.push(content.data.structuredContent);
    for (const item of (content.data.content ?? []).slice(0, 16)) {
      const text = textContentSchema.safeParse(item);
      if (!text.success) {
        continue;
      }
      try {
        candidates.push(JSON.parse(text.data.text));
      } catch {
        continue;
      }
    }
  }
  const identity = candidates
    .map((candidate) => resultIdentitySchema.safeParse(candidate))
    .find(
      (candidate) =>
        candidate.success &&
        Object.values(candidate.data).some((value) => value !== undefined)
    );
  let url: string | null = null;
  const candidateUrl =
    identity?.success === true
      ? (identity.data.url ?? identity.data.htmlLink ?? identity.data.webUrl)
      : undefined;
  if (candidateUrl !== undefined) {
    try {
      const parsed = new URL(candidateUrl);
      if (
        parsed.protocol === "https:" &&
        parsed.href.length <= 2048 &&
        (["linear.app", "calendar.google.com"].some(
          (hostname) =>
            parsed.hostname === hostname ||
            parsed.hostname.endsWith(`.${hostname}`)
        ) ||
          (parsed.hostname === "www.google.com" &&
            parsed.pathname.startsWith("/calendar/")))
      ) {
        url = parsed.href;
      }
    } catch {
      url = null;
    }
  }
  return {
    externalId:
      identity?.success === true
        ? (identity.data.id ??
          identity.data.draftId ??
          identity.data.eventId ??
          null)
        : null,
    title:
      identity?.success === true
        ? (identity.data.title ?? identity.data.summary ?? null)
        : null,
    url,
  };
};

export const boundAgentToolOutput = (value: unknown) => {
  const serialized = JSON.stringify(value) ?? "null";
  if (serialized.length <= 8000) {
    return value;
  }
  const identity = getResultIdentity(value);
  const continuation = continuationSchema.safeParse(value);
  const title =
    JSON.stringify(identity).length > 4000
      ? identity.title?.slice(0, 128)
      : identity.title;
  const envelope = {
    ...(identity.externalId === null ? {} : { id: identity.externalId }),
    ...(title === null || title === undefined ? {} : { title }),
    ...(identity.url === null ? {} : { url: identity.url }),
    ...(continuation.success ? continuation.data : {}),
    truncated: true,
  };
  let low = 0;
  let high = Math.min(serialized.length, 8000);
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    if (
      JSON.stringify({ ...envelope, value: serialized.slice(0, length) })
        .length > 8000
    ) {
      high = length - 1;
    } else {
      low = length;
    }
  }
  return { ...envelope, value: serialized.slice(0, low) };
};

export const getAgentEffectView = (
  effect: typeof mailboxAgentEffect.$inferSelect,
  capabilities: { toolId: string; label: string }[]
) => ({
  ...getResultIdentity(effect.result),
  id: effect.id,
  label:
    capabilities.find((capability) =>
      effect.toolId.endsWith(`:${capability.toolId}`)
    )?.label ?? "Connected account change",
  status: effect.status,
});
