import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { captureQueryPersistenceCleanup } from "@quieter/app/lib/query-persister";

export const registerSignOutCleanup = () => {
  const captured = new Map<string, readonly (() => Promise<void>)[]>();
  const stopCleanup = window.quieterDesktop.onSignOutCleanup(
    async (command) => {
      if (command.phase === "release") {
        captured.delete(command.requestId);
        return;
      }
      if (command.phase === "capture") {
        if (captured.size > 0) {
          throw new Error("Sign-out is already in progress.");
        }
        captured.set(command.requestId, [
          draftRecoveryJournal.captureCleanup(),
          captureQueryPersistenceCleanup(),
        ]);
        return;
      }
      const cleanups = captured.get(command.requestId);
      captured.delete(command.requestId);
      if (!cleanups) {
        throw new Error("This sign-out request is no longer active.");
      }
      const results = await Promise.allSettled(
        cleanups.map(async (cleanup) => {
          await cleanup();
        })
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        const error = new AggregateError(
          failures.map((failure): unknown => failure.reason),
          "Sign-out cleanup failed."
        );
        toastError(error, { boundary: "desktop-sign-out-cache" });
        throw error;
      }
    }
  );
  return () => {
    stopCleanup();
    captured.clear();
  };
};
