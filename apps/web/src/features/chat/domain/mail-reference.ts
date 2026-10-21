import { z } from "zod";

const mailReferenceSchema = z.strictObject({
  from: z.string().trim().max(320).optional(),
  messageId: z.string().regex(/^[\w-]{1,256}$/u),
  subject: z.string().trim().max(1000).optional(),
  threadId: z
    .string()
    .regex(/^[\w-]{1,256}$/u)
    .optional(),
});

export const parseMailReference = (href: string | undefined) => {
  if (href === undefined || !href.startsWith("/mail-reference?")) {
    return null;
  }
  const url = new URL(href, "https://quieter.invalid");
  if (url.hash !== "") {
    return null;
  }
  const entries = [...url.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    return null;
  }
  const result = mailReferenceSchema.safeParse(Object.fromEntries(entries));
  return result.success ? result.data : null;
};
