/// <reference types="node" />
import { createHash } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  createMailPayloadUpload,
  completeMailPayloadUpload,
} from "@quieter/database/mail-payload-uploads";
import { describe, expect, test, vi, beforeEach } from "vite-plus/test";

import {
  prepareMailSubmissionPayload,
  readMailSubmissionMessage,
} from "../src/mail-submission-payload.ts";
import type { SubmissionPayloadStorage } from "../src/mail-submission-payload.ts";

vi.mock(import("@quieter/database/mail-payload-uploads"), () => ({
  completeMailPayloadUpload: vi.fn<typeof completeMailPayloadUpload>(),
  createMailPayloadUpload: vi.fn<typeof createMailPayloadUpload>(),
}));

describe("submission payload preparation", () => {
  const data = new Map<string, Uint8Array>();
  const storage: SubmissionPayloadStorage = {
    // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
    async read(object) {
      const value = data.get(object.key);
      if (value === undefined) {
        throw new Error("Missing fixture object.");
      }
      return value;
    },
    // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
    async remove(key) {
      data.delete(key);
    },
    // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
    async write(object, bytes) {
      data.set(object.key, bytes);
    },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    data.clear();
    vi.mocked(createMailPayloadUpload).mockImplementation(
      // oxlint-disable-next-line require-await -- This fake lease is created without database I/O.
      async (_database, input) => ({
        cleanupGeneration: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
        id: "fixture",
        nextActionAt: new Date(Date.now() + 600_000),
        objects: input.objects.map((object, index) => ({
          ...object,
          key: `fixture/${index}`,
        })),
        organizationId: input.organizationId,
        status: "uploading",
      })
    );
  });

  /* oxlint-disable vitest/max-expects -- Verify the complete persisted message contract and corruption boundary together. */
  test("preserves inline attachments, repeated headers, metadata, and tracking across durable storage", async () => {
    const message = {
      attachments: [
        {
          content: Buffer.from("fixture image").toString("base64"),
          contentId: "image",
          contentType: "image/png",
          disposition: "inline",
          filename: "image.png",
        },
      ],
      bcc: ["hidden@example.com"],
      from: "Sender <sender@example.com>",
      headers: [
        { name: "X-Custom", value: "one" },
        { name: "X-Custom", value: "two" },
      ],
      html: '<img src="cid:image">',
      metadata: { count: 1, key: "value" },
      replyTo: ["reply@example.com"],
      subject: "fixture",
      tags: [{ name: "campaign", value: "test" }],
      text: "hello",
      to: ["reader@example.com"],
    };
    const prepared = await prepareMailSubmissionPayload(db, {
      message,
      openTracking: true,
      organizationId: "organization",
      storage,
      transformHtml: (html) => `${html}<img src="https://example.com/pixel">`,
    });
    expect(prepared.payload).toMatchObject({
      headers: message.headers,
      html: message.html,
      metadata: message.metadata,
      openTracking: true,
      tags: message.tags,
    });
    expect(prepared.payload.attachments[0]).toMatchObject({
      bytes: 13,
      contentId: "image",
      digest: createHash("sha256").update("fixture image").digest("hex"),
      disposition: "inline",
    });
    expect(prepared.recipientCount).toBe(2);
    expect(completeMailPayloadUpload).toHaveBeenCalledExactlyOnceWith(db, {
      id: "fixture",
      organizationId: "organization",
    });
    const restored = await readMailSubmissionMessage({
      payload: structuredClone(prepared.payload),
      storage,
    });
    expect(restored.headers).toStrictEqual(message.headers);
    expect(restored.bcc).toStrictEqual(message.bcc);
    expect(restored.messageHeaderId).toBe(prepared.payload.messageHeaderId);
    expect(restored.raw).toContain(
      'Content-Disposition: inline; filename="image.png"'
    );
    expect(restored.raw).not.toContain("Bcc:");
    data.set("fixture/0", new Uint8Array(13));
    await expect(
      readMailSubmissionMessage({ payload: prepared.payload, storage })
    ).rejects.toThrow("integrity verification");
  });
  /* oxlint-enable vitest/max-expects */

  test("does not mark partially written attachments ready", async () => {
    const message = {
      attachments: [{ content: "YQ==", filename: "fixture.txt" }],
      from: "sender@example.com",
      subject: "fixture",
      text: "hello",
      to: ["reader@example.com"],
    };
    await expect(
      prepareMailSubmissionPayload(db, {
        message,
        openTracking: false,
        organizationId: "organization",
        storage: {
          ...storage,
          // oxlint-disable-next-line require-await -- In-memory test adapter preserves the asynchronous storage contract.
          async write() {
            throw new Error("Storage unavailable.");
          },
        },
      })
    ).rejects.toThrow("Storage unavailable");
    expect(completeMailPayloadUpload).not.toHaveBeenCalled();
  });

  test("rejects reserved tags before allocating storage", async () => {
    const message = {
      from: "sender@example.com",
      subject: "fixture",
      tags: [{ name: "Quieter_attempt", value: "spoof" }],
      text: "hello",
      to: ["reader@example.com"],
    };
    await expect(
      prepareMailSubmissionPayload(db, {
        message,
        openTracking: false,
        organizationId: "organization",
        storage,
      })
    ).rejects.toThrow("tags exceed");
    expect(createMailPayloadUpload).not.toHaveBeenCalled();
  });
});
