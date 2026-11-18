import { randomUUID } from "node:crypto";

import type {
  NativeLinkReadInput,
  NativeMailIntent,
  NativeMailTarget,
} from "../shared/native-links";

type NativeSession = Readonly<{ userId: string; sessionId: string }>;
type PendingNativeLink = {
  intent: NativeMailIntent;
  owner:
    | { kind: "unresolved" }
    | { kind: "signed-out" }
    | { kind: "session"; session: NativeSession };
};

type NativeLinkInboxOptions = {
  getSession: () => Promise<NativeSession | null>;
  onPending: () => void;
};

export class NativeLinkInbox {
  private pending: PendingNativeLink | undefined;
  private generation = 0;
  private ready = false;

  private readonly options: NativeLinkInboxOptions;

  constructor(options: NativeLinkInboxOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.ready = true;
    if (this.pending) {
      await this.resolveOwner(this.pending, this.generation);
    }
  }

  async receive(target: NativeMailTarget): Promise<void> {
    const pending: PendingNativeLink = {
      intent: { id: randomUUID(), target },
      owner: { kind: "unresolved" },
    };
    this.pending = pending;
    if (this.ready) {
      await this.resolveOwner(pending, this.generation);
    }
  }

  private async resolveOwner(
    pending: PendingNativeLink,
    generation: number
  ): Promise<void> {
    const session = await this.options.getSession();
    if (this.pending !== pending || this.generation !== generation) {
      return;
    }
    pending.owner = session
      ? { kind: "session", session }
      : { kind: "signed-out" };
    this.options.onPending();
  }

  notifyPending(): void {
    if (this.ready && this.pending) {
      this.options.onPending();
    }
  }

  beginAuthentication(): void {
    this.generation += 1;
    if (this.pending?.owner.kind !== "signed-out") {
      this.pending = undefined;
    }
  }

  clear(): void {
    this.generation += 1;
    this.pending = undefined;
  }

  async read({
    input,
    assertCurrent,
  }: {
    input: NativeLinkReadInput;
    assertCurrent: () => void;
  }): Promise<NativeMailIntent | null> {
    const { pending, generation } = this;
    if (
      !(this.ready && pending) ||
      (input.kind === "take" && input.id !== pending.intent.id)
    ) {
      return null;
    }
    const session = await this.options.getSession();
    assertCurrent();
    if (this.pending !== pending || this.generation !== generation) {
      return null;
    }
    if (pending.owner.kind === "unresolved") {
      pending.owner = session
        ? { kind: "session", session }
        : { kind: "signed-out" };
    }
    if (
      pending.owner.kind === "session" &&
      (session?.userId !== pending.owner.session.userId ||
        session.sessionId !== pending.owner.session.sessionId)
    ) {
      this.pending = undefined;
      return null;
    }
    if (session?.userId !== input.userId) {
      return null;
    }
    pending.owner = { kind: "session", session };
    if (input.kind === "take") {
      this.pending = undefined;
    }
    return pending.intent;
  }
}
