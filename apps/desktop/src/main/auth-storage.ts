import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { app, safeStorage } from "electron";

export const createAuthStorage = (onWriteError: () => void) => {
  const values = new Map<string, string>();
  let pendingWrite = Promise.resolve();
  let storagePath = "";
  let persistenceError: Error | undefined;

  return {
    flush: async () => {
      await pendingWrite;
      if (persistenceError !== undefined) {
        throw persistenceError;
      }
    },
    initialize: async () => {
      if (
        !safeStorage.isEncryptionAvailable() ||
        (process.platform === "linux" &&
          safeStorage.getSelectedStorageBackend() === "basic_text")
      ) {
        throw new Error(
          "Your system's secure credential storage is unavailable. Enable the system keychain, then reopen quieter."
        );
      }
      const storageDirectory = path.join(app.getPath("userData"), "auth");
      await mkdir(storageDirectory, { mode: 0o700, recursive: true });
      storagePath = path.join(storageDirectory, "credentials.json");
      let serialized: string;
      try {
        serialized = await readFile(storagePath, "utf-8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return;
        }
        throw error;
      }
      const stored: unknown = JSON.parse(serialized);
      if (
        stored === null ||
        typeof stored !== "object" ||
        Array.isArray(stored)
      ) {
        throw new Error(
          "quieter could not read its saved sign-in. Remove the saved credentials file and sign in again."
        );
      }
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === "string") {
          values.set(key, value);
        }
      }
    },
    storage: {
      getItem: (name: string): string | null => values.get(name) ?? null,
      setItem: (name: string, value: unknown): void => {
        if (!storagePath || typeof value !== "string") {
          throw new Error(
            "Secure credential storage has not been initialized."
          );
        }
        values.set(name, value);
        const serialized = JSON.stringify(Object.fromEntries(values));
        const previousWrite = pendingWrite;
        pendingWrite = (async () => {
          await previousWrite;
          try {
            const temporaryPath = `${storagePath}.tmp`;
            await writeFile(temporaryPath, serialized, { mode: 0o600 });
            await rename(temporaryPath, storagePath);
            persistenceError = undefined;
          } catch (error) {
            persistenceError =
              error instanceof Error
                ? error
                : new Error("Could not save credentials.");
            onWriteError();
          }
        })();
        // The SDK encrypts these values with safeStorage before calling this adapter.
      },
    },
  };
};
