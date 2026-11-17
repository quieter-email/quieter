import { DESKTOP_AUTH_PROTOCOL_SCHEME } from "@quieter/auth/desktop";
import { z } from "zod";

const nativeLinkId = z
  .string()
  .min(1)
  .max(500)
  .regex(/^\P{Cc}+$/u)
  .refine((value) => value.trim() === value);

export const nativeMailTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("mailto"),
    url: z
      .string()
      .max(32_768)
      .regex(/^mailto:/iu),
  }),
  z.strictObject({
    kind: z.literal("mail"),
    mailboxId: nativeLinkId,
    messageId: nativeLinkId,
    threadId: nativeLinkId,
  }),
]);

export type NativeMailTarget = z.infer<typeof nativeMailTargetSchema>;

export const nativeMailIntentSchema = z.strictObject({
  id: z.uuid(),
  target: nativeMailTargetSchema,
});
export type NativeMailIntent = z.infer<typeof nativeMailIntentSchema>;

export const nativeLinkReadInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("peek"), userId: nativeLinkId }),
  z.strictObject({
    id: z.uuid(),
    kind: z.literal("take"),
    userId: nativeLinkId,
  }),
]);
export type NativeLinkReadInput = z.infer<typeof nativeLinkReadInput>;

export const parseNativeMailTarget = (
  input: unknown
): NativeMailTarget | null => {
  if (
    typeof input !== "string" ||
    input.length > 32_768 ||
    !/^\P{Cc}+$/u.test(input)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") {
    if (url.host || input.includes("#")) {
      return null;
    }
    try {
      if (!/^\P{Cc}*$/u.test(decodeURIComponent(url.pathname))) {
        return null;
      }
    } catch {
      return null;
    }
    const parsed = nativeMailTargetSchema.safeParse({
      kind: "mailto",
      url: input,
    });
    return parsed.success ? parsed.data : null;
  }
  if (
    !input.toLowerCase().startsWith(`${DESKTOP_AUTH_PROTOCOL_SCHEME}:/mail?`) ||
    url.protocol !== `${DESKTOP_AUTH_PROTOCOL_SCHEME}:` ||
    url.pathname !== "/mail" ||
    url.host ||
    url.username ||
    url.password ||
    input.includes("#") ||
    url.searchParams.size !== 3 ||
    url.searchParams.getAll("mailboxId").length !== 1 ||
    url.searchParams.getAll("messageId").length !== 1 ||
    url.searchParams.getAll("threadId").length !== 1
  ) {
    return null;
  }
  const parsed = nativeMailTargetSchema.safeParse({
    kind: "mail",
    mailboxId: url.searchParams.get("mailboxId"),
    messageId: url.searchParams.get("messageId"),
    threadId: url.searchParams.get("threadId"),
  });
  return parsed.success ? parsed.data : null;
};
