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
        const clearRecovery = draftRecoveryJournal.captureCleanup();
        const clearQueries = captureQueryPersistenceCleanup();
        if (!(clearRecovery && clearQueries)) {
          throw new Error("Your session is still loading. Please try again.");
        }
        const cleanups = [clearRecovery, clearQueries];
        captured.set(command.requestId, cleanups);
        try {
          const current = await clearQueries.isCurrent();
          if (captured.get(command.requestId) !== cleanups) {
            throw new Error("This sign-out request is no longer active.");
          }
          if (!current) {
            throw new Error("Your session has changed. Please try again.");
          }
        } catch (error) {
          if (captured.get(command.requestId) === cleanups) {
            captured.delete(command.requestId);
          }
          throw error;
        }
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
