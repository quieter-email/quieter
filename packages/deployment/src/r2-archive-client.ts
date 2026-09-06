import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

export const createR2ArchiveClient = (input: {
  accountId: string;
  bucket: string;
  parentAccessKeyId: string;
  readOnly: boolean;
  token: string;
}) => {
  z.string()
    .regex(/^[a-f\d]{32}$/u)
    .parse(input.accountId);
  z.string()
    .regex(/^[a-f\d]{32}$/u)
    .parse(input.parentAccessKeyId);
  return new S3Client({
    credentials: async () => {
      const expiresAt = Date.now() + 600_000;
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/r2/temp-access-credentials`,
        {
          body: JSON.stringify({
            bucket: input.bucket,
            parentAccessKeyId: input.parentAccessKeyId,
            permission: input.readOnly
              ? "object-read-only"
              : "object-read-write",
            prefixes: ["assets/", "receipts/"],
            ttlSeconds: 600,
          }),
          headers: {
            authorization: `Bearer ${input.token}`,
            "content-type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Cannot obtain temporary archive access, HTTP ${response.status}.`
        );
      }
      const result = z
        .object({
          result: z.object({
            accessKeyId: z.string().min(1),
            secretAccessKey: z.string().min(1),
            sessionToken: z.string().min(1),
          }),
          success: z.literal(true),
        })
        .safeParse(await response.json().catch(() => null));
      if (!result.success) {
        throw new Error("Invalid temporary archive credential response.");
      }
      return {
        ...result.data.result,
        expiration: new Date(expiresAt),
      };
    },
    endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
    maxAttempts: 3,
    region: "auto",
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: {
      connectionTimeout: 5000,
      requestTimeout: 15_000,
      throwOnRequestTimeout: true,
    },
  });
};
