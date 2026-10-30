import { randomUUID } from "node:crypto";

import { signOutCleanupAcknowledgement } from "../shared/bridge";
import type { SignOutCleanupCommand } from "../shared/bridge";

type PendingAcknowledgement = {
  phase: "capture" | "cleanup";
  resolve: () => void;
  reject: (error: Error) => void;
};

export class SignOutCleanup {
  private active:
    | {
        requestId: string;
        pending: PendingAcknowledgement | undefined;
        cancel: (error: Error) => void;
      }
    | undefined;

  acknowledge(input: unknown): void {
    const acknowledgement = signOutCleanupAcknowledgement.parse(input);
    const { active } = this;
    if (
      !active ||
      acknowledgement.requestId !== active.requestId ||
      acknowledgement.phase !== active.pending?.phase
    ) {
      throw new Error("This sign-out request is no longer active.");
    }
    const { pending } = active;
    active.pending = undefined;
    if (acknowledgement.success) {
      pending.resolve();
    } else {
      pending.reject(
        new Error("Sign-out cleanup could not be completed. Try again.")
      );
    }
  }

  cancel(): void {
    this.active?.cancel(
      new Error("The sign-out window was closed or reloaded. Try again.")
    );
  }

  async run({
    send,
    signOut,
    timeoutMs = 30_000,
  }: {
    send: (command: SignOutCleanupCommand) => void;
    signOut: () => Promise<void>;
    timeoutMs?: number;
  }): Promise<void> {
    if (this.active) {
      throw new Error("Sign-out is already in progress.");
    }
    const { promise: cancelled, reject: cancel } =
      Promise.withResolvers<never>();
    const active: NonNullable<SignOutCleanup["active"]> = {
      cancel,
      pending: undefined,
      requestId: randomUUID(),
    };
    this.active = active;
    const timeout = setTimeout(() => {
      cancel(new Error("Sign-out timed out. Try again."));
    }, timeoutMs);
    const request = async (phase: "capture" | "cleanup") => {
      const { promise, resolve, reject } = Promise.withResolvers<null>();
      active.pending = {
        phase,
        reject,
        resolve: () => {
          resolve(null);
        },
      };
      send({ phase, requestId: active.requestId });
      return await promise;
    };
    try {
      await Promise.race([request("capture"), cancelled]);
      await Promise.race([signOut(), cancelled]);
      await Promise.race([request("cleanup"), cancelled]);
    } finally {
      clearTimeout(timeout);
      this.active = undefined;
      try {
        send({ phase: "release", requestId: active.requestId });
      } catch {
        // The window can disappear before the release message is sent.
      }
    }
  }
}
