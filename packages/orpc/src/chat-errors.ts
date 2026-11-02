import { z } from "zod";

const chatExpectedErrorSchema = z.strictObject({
  kind: z.literal("quieter.chat.expected-error"),
  message: z.string().refine((message) => message.trim().length > 0),
  status: z.number().int().min(400).max(499),
  version: z.literal(1),
});

export const encodeChatExpectedError = (error: {
  message: string;
  status: number;
}): string =>
  JSON.stringify(
    chatExpectedErrorSchema.parse({
      ...error,
      kind: "quieter.chat.expected-error",
      version: 1,
    })
  );

export const decodeChatStreamError = (error: Error): Error => {
  let payload: unknown;
  try {
    payload = JSON.parse(error.message);
  } catch {
    return error;
  }
  const result = chatExpectedErrorSchema.safeParse(payload);
  if (!result.success) {
    return error;
  }
  return Object.assign(new Error(result.data.message), {
    status: result.data.status,
  });
};
