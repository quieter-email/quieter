import { Store, useSelector } from "@tanstack/react-store";

export type ToastTone = "default" | "error";

export type AppToast = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastState = {
  toasts: AppToast[];
};

const TOAST_DURATION_MS = 5000;

const toastStore = new Store<ToastState>({ toasts: [] });
let nextToastId = 0;

export const dismissToast = (id: string) => {
  toastStore.setState((state) => ({
    toasts: state.toasts.filter((entry) => entry.id !== id),
  }));
};

const pushToast = (message: string, tone: ToastTone) => {
  nextToastId += 1;
  const id = `toast-${nextToastId}`;
  toastStore.setState((state) => ({
    toasts: [...state.toasts.slice(-2), { id, message, tone }],
  }));
  setTimeout(() => {
    dismissToast(id);
  }, TOAST_DURATION_MS);
};

export const toast = {
  error: (message: string) => {
    pushToast(message, "error");
  },
  message: (message: string) => {
    pushToast(message, "default");
  },
};

const findUserFacingMessage = (error: unknown): string | undefined => {
  let current: unknown = error;
  const visited = new Set<unknown>();
  while (
    current !== null &&
    current !== undefined &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const candidate = current as {
      cause?: unknown;
      message?: unknown;
      status?: unknown;
    };
    if (typeof candidate.status === "number") {
      if (
        candidate.status >= 400 &&
        candidate.status < 500 &&
        typeof candidate.message === "string" &&
        candidate.message.trim().length > 0
      ) {
        return candidate.message;
      }
      return undefined;
    }
    current = candidate.cause;
  }
  return undefined;
};

/**
 * Mirrors the web toast contract: user-driven failures show the server
 * message verbatim; everything else falls back to a retry message.
 */
export const toastError = (
  error: unknown,
  fallback = "Something went wrong. Please try again."
): void => {
  toast.error(findUserFacingMessage(error) ?? fallback);
};

export const useToasts = () => useSelector(toastStore, (state) => state.toasts);
