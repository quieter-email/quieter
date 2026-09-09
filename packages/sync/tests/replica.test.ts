import { describe, expect, it } from "vite-plus/test";

import {
  encodeSyncBatch,
  syncBatchSchema,
  syncMessageSchema,
  syncSequenceSchema,
} from "../src/protocol";
import type { SyncBatch, SyncChange, SyncSnapshot } from "../src/protocol";
import {
  classifySyncBatch,
  mergeSyncChanges,
  reconcileSyncRange,
} from "../src/replica";

const epoch = "dd261684-601f-4b58-b9b0-ea02a7773552";
const generation = "0dc0cb9e-2a6e-4e4c-8800-5127ab84666e";
const change = (version: string, deleted = false): SyncChange => ({
  data: deleted
    ? null
    : { kind: "label", value: { id: "label", name: "Work" } },
  id: "label",
  kind: "label",
  version,
});
const batch = (sequence: string, deleted = false): SyncBatch => ({
  changes: [change(sequence, deleted)],
  epoch,
  mailboxId: "mailbox",
  protocol: 1,
  sequence,
});

describe("mail replica ordering", () => {
  it("accepts long opaque attachment identifiers without relaxing entity identifiers", () => {
    const message = {
      attachments: [
        {
          attachmentId: "a".repeat(768),
          fileName: "attachment.txt",
          mimeType: "text/plain",
          size: 12,
        },
      ],
      body: null,
      id: "message",
      isUnread: false,
      labelIds: [],
      threadId: "thread",
    };
    expect(syncMessageSchema.safeParse(message).success).toBeTruthy();
    expect(
      syncMessageSchema.safeParse({ ...message, id: "a".repeat(768) }).success
    ).toBeFalsy();
  });

  it("detects gaps and retains precision beyond JavaScript numbers", () => {
    const checkpoint = { epoch, sequence: "9007199254740992" };
    expect(classifySyncBatch(checkpoint, batch("9007199254740993"))).toBe(
      "apply"
    );
    expect(classifySyncBatch(checkpoint, batch("9007199254740994"))).toBe(
      "gap"
    );
    expect(classifySyncBatch(checkpoint, batch("9007199254740992"))).toBe(
      "duplicate"
    );
    expect(
      syncSequenceSchema.safeParse("9223372036854775808").success
    ).toBeFalsy();
  });

  it("never resurrects a deletion from an older hydration", () => {
    const deleted = mergeSyncChanges(new Map(), [change("3", true)]);
    const merged = mergeSyncChanges(deleted, [change("1"), change("2")]);
    expect(merged.get("label:label")?.data).toBeNull();
  });

  it("requires every intervening batch before declaring a partial range current", () => {
    const snapshot: SyncSnapshot = {
      checkpoint: { epoch, sequence: "1" },
      coverage: { complete: true, kind: "threads", threadIds: [] },
      entities: [change("1")],
      mailboxId: "mailbox",
    };
    expect(() =>
      reconcileSyncRange(snapshot, { epoch, sequence: "3" }, [batch("3", true)])
    ).toThrow("missing");
    expect(
      reconcileSyncRange(snapshot, { epoch, sequence: "3" }, [
        batch("2"),
        batch("3", true),
      ]).get("label:label")?.data
    ).toBeNull();
  });

  it("rejects entity versions outside their committed batch", () => {
    expect(
      syncBatchSchema.safeParse({ ...batch("2"), changes: [change("3")] })
        .success
    ).toBeFalsy();
  });

  it("chunks large unicode payloads without exceeding the frame budget or losing content", () => {
    const large: SyncBatch = {
      ...batch("1"),
      changes: [
        {
          ...change("1"),
          data: {
            kind: "label",
            value: { id: "label", name: '📨\\"'.repeat(100_000) },
          },
        },
      ],
    };
    const frames = encodeSyncBatch(large, generation);
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) {
      expect(new TextEncoder().encode(frame).byteLength).toBeLessThanOrEqual(
        256 * 1024
      );
    }
  });
});
