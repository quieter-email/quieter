"use client";

import { Toast } from "@base-ui/react/toast";

export const toastManager = Toast.createToastManager();

export const DEFAULT_TOAST_TIMEOUT = 4000;

type ToastType = "default" | "success" | "error" | "warning" | "info" | "loading";

export type ToastOptions = {
  description?: string;
  duration?: number;
  id?: string;
};

type PromiseMessage<T> = string | ToastOptions | ((value: T) => string | ToastOptions);

type PromiseOptions<T> = {
  error: PromiseMessage<unknown>;
  loading: string | ToastOptions;
  success: PromiseMessage<T>;
};

type ManagerUpdate = Parameters<typeof toastManager.update>[1];

const toastIdFor = (type: ToastType, title: string, description?: string) =>
  `toast:${type}:${title}${description ? `:${description}` : ""}`;

const toAddOptions = (type: ToastType, title: string, options: ToastOptions = {}) => ({
  description: options.description,
  id: options.id ?? toastIdFor(type, title, options.description),
  timeout:
    type === "loading" ? (options.duration ?? 0) : (options.duration ?? DEFAULT_TOAST_TIMEOUT),
  title,
  type,
});

const toUpdateOptions = (options: string | ToastOptions): ManagerUpdate => {
  if (typeof options === "string") {
    return { title: options, timeout: DEFAULT_TOAST_TIMEOUT };
  }

  return {
    description: options.description,
    timeout: options.duration ?? DEFAULT_TOAST_TIMEOUT,
  };
};

const resolvePromiseMessage = <T>(
  message: PromiseMessage<T>,
): ManagerUpdate | ((value: T) => ManagerUpdate) => {
  if (typeof message === "function") {
    return (value: T) => toUpdateOptions(message(value));
  }

  return toUpdateOptions(message);
};

const showToast = (type: ToastType, title: string, options?: ToastOptions) =>
  toastManager.add(toAddOptions(type, title, options));

const toastFn = (title: string, options?: ToastOptions) => showToast("default", title, options);

export const toast = Object.assign(toastFn, {
  dismiss: (id?: string) => toastManager.close(id),
  error: (title: string, options?: ToastOptions) => showToast("error", title, options),
  info: (title: string, options?: ToastOptions) => showToast("info", title, options),
  loading: (title: string, options?: ToastOptions) => showToast("loading", title, options),
  message: (title: string, options?: ToastOptions) => showToast("default", title, options),
  promise: <T>(promiseValue: Promise<T>, options: PromiseOptions<T>) =>
    toastManager.promise(promiseValue, {
      error: resolvePromiseMessage(options.error),
      loading: { ...toUpdateOptions(options.loading), timeout: 0 },
      success: resolvePromiseMessage(options.success),
    }),
  success: (title: string, options?: ToastOptions) => showToast("success", title, options),
  warning: (title: string, options?: ToastOptions) => showToast("warning", title, options),
});
