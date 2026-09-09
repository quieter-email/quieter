import {
  SYNC_FRAME_BYTES,
  syncBatchSchema,
  syncServerFrameSchema,
} from "@quieter/sync";
import type { SyncServerFrame } from "@quieter/sync";

type ChunkFrame = Extract<SyncServerFrame, { type: "CHUNK" }>;
type Transfer = {
  frame: ChunkFrame;
  chunks: Map<number, string>;
  bytes: number;
  startedAt: number;
};

export class SyncFrameAssembler {
  private readonly transfers = new Map<string, Transfer>();

  reset() {
    this.transfers.clear();
  }

  accept(
    raw: string,
    now = Date.now()
  ): Exclude<SyncServerFrame, ChunkFrame> | null {
    if (new TextEncoder().encode(raw).byteLength > SYNC_FRAME_BYTES) {
      throw new Error("Sync frame is too large.");
    }
    const frame = syncServerFrameSchema.parse(JSON.parse(raw));
    for (const [key, transfer] of this.transfers) {
      if (now - transfer.startedAt > 15_000) {
        this.transfers.delete(key);
      }
    }
    if (frame.type !== "CHUNK") {
      return frame;
    }
    if (frame.index >= frame.total) {
      throw new Error("Invalid sync fragment.");
    }
    const key = `${frame.mailboxId}:${frame.generation}:${frame.checkpoint.epoch}:${frame.checkpoint.sequence}`;
    const transfer = this.transfers.get(key) ?? {
      bytes: 0,
      chunks: new Map<number, string>(),
      frame,
      startedAt: now,
    };
    if (transfer.frame.total !== frame.total) {
      throw new Error("Inconsistent sync fragments.");
    }
    const previous = transfer.chunks.get(frame.index);
    if (previous !== undefined && previous !== frame.payload) {
      throw new Error("Conflicting sync fragments.");
    }
    if (previous === undefined) {
      transfer.bytes += new TextEncoder().encode(frame.payload).byteLength;
      transfer.chunks.set(frame.index, frame.payload);
    }
    this.transfers.set(key, transfer);
    const bytes = [...this.transfers.values()].reduce(
      (total, value) => total + value.bytes,
      0
    );
    if (this.transfers.size > 4 || bytes > 12 * 1024 * 1024) {
      this.transfers.clear();
      throw new Error("Sync fragments exceeded their memory limit.");
    }
    if (transfer.chunks.size !== frame.total) {
      return null;
    }
    const payload = Array.from(
      { length: frame.total },
      (_, index) => transfer.chunks.get(index) ?? ""
    ).join("");
    this.transfers.delete(key);
    const batch = syncBatchSchema.parse(JSON.parse(payload));
    if (
      batch.mailboxId !== frame.mailboxId ||
      batch.epoch !== frame.checkpoint.epoch ||
      batch.sequence !== frame.checkpoint.sequence
    ) {
      throw new Error("Sync fragment identity does not match its payload.");
    }
    return { batch, generation: frame.generation, type: "PATCH" };
  }
}
