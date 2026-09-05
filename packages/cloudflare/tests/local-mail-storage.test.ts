import {
  getLocalMailStorage,
  LOCAL_MAIL_BUCKET,
} from "@quieter/orpc/managed-mail/local-storage";
import {
  deleteRawMailObject,
  readRawMailObject,
} from "@quieter/orpc/managed-mail/raw-object";
import { describe, expect, test, vi } from "vite-plus/test";

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

describe("native local mail storage", () => {
  test("reads and deletes raw MIME bytes through the real local R2 binding", async () => {
    const key = `fixtures/${crypto.randomUUID()}.eml`;
    const raw = new TextEncoder().encode(
      "Subject: local fixture\r\n\r\nAttachment bytes: café\r\n"
    );
    const record = {
      rawObjectBucket: LOCAL_MAIL_BUCKET,
      rawObjectKey: key,
      rawObjectProvider: "r2" as const,
      s3Bucket: null,
      s3Key: null,
    };
    await getLocalMailStorage().put(key, raw);
    await expect(readRawMailObject(record)).resolves.toStrictEqual(raw);
    await deleteRawMailObject({
      bucket: LOCAL_MAIL_BUCKET,
      key,
      provider: "r2",
    });
    await expect(readRawMailObject(record)).rejects.toThrow(
      "fixture is missing"
    );
  });

  test("rejects remote object references before making provider calls", async () => {
    const record = {
      rawObjectBucket: "quieter-managed-mail",
      rawObjectKey: "private.eml",
      rawObjectProvider: "r2" as const,
      s3Bucket: null,
      s3Key: null,
    };
    await expect(readRawMailObject(record)).rejects.toThrow(
      "cannot access remote"
    );
    await expect(
      deleteRawMailObject({
        bucket: record.rawObjectBucket,
        key: record.rawObjectKey,
        provider: "r2",
      })
    ).rejects.toThrow("cannot access remote");
    await expect(
      readRawMailObject({
        ...record,
        rawObjectBucket: null,
        rawObjectKey: null,
        rawObjectProvider: null,
        s3Bucket: "production-mail",
        s3Key: "private.eml",
      })
    ).rejects.toThrow("cannot access remote");
  });
});
