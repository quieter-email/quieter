import { z } from "zod";

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) =>
    value
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          part.trim() === part &&
          !part.endsWith(".") &&
          !/[\\:<>"|?*\p{Cc}]/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
      )
  );

const sizeEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.literal("distribution"),
    path: relativePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  z.strictObject({
    files: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.literal("unpacked-app"),
    path: relativePathSchema,
    regularFileBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    symlinksSkipped: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  }),
]);

export const sizeReportSchema = z.strictObject({
  entries: z.array(sizeEntrySchema).min(1),
  hostArchitecture: z.string().min(1),
  packageVersion: z.string().min(1),
  platform: z
    .string()
    .refine((value) => ["darwin", "linux", "win32"].includes(value)),
  schemaVersion: z.literal(1),
  sourceDirty: z.boolean(),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
});

export type SizeEntry = z.infer<typeof sizeEntrySchema>;
export type SizeReport = z.infer<typeof sizeReportSchema>;
