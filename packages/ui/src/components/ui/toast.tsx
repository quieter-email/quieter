"use client";

import { Toast } from "@base-ui/react/toast";
import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import { IconButtonTooltip } from "./icon-button-tooltip";

const toastManager = Toast.createToastManager();

const DEFAULT_TIMEOUT = 4000;

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
  timeout: type === "loading" ? (options.duration ?? 0) : (options.duration ?? DEFAULT_TIMEOUT),
  title,
  type,
});

const toUpdateOptions = (options: string | ToastOptions): ManagerUpdate => {
  if (typeof options === "string") {
    return { title: options, timeout: DEFAULT_TIMEOUT };
  }

  return {
    description: options.description,
    timeout: options.duration ?? DEFAULT_TIMEOUT,
  };
};

const resolvePromiseMessage = <T,>(
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
  promise: <T,>(promiseValue: Promise<T>, options: PromiseOptions<T>) =>
    toastManager.promise(promiseValue, {
      error: resolvePromiseMessage(options.error),
      loading: { ...toUpdateOptions(options.loading), timeout: 0 },
      success: resolvePromiseMessage(options.success),
    }),
  success: (title: string, options?: ToastOptions) => showToast("success", title, options),
  warning: (title: string, options?: ToastOptions) => showToast("warning", title, options),
});

const ToastIcon = ({ type }: { type: string | undefined }) => {
  if (type === "success") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-success">
        <HugeiconsIcon aria-hidden className="size-4" icon={CheckmarkCircle02Icon} />
      </span>
    );
  }

  if (type === "error") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-destructive">
        <HugeiconsIcon aria-hidden className="size-4" icon={Alert02Icon} />
      </span>
    );
  }

  if (type === "warning") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-warning">
        <HugeiconsIcon aria-hidden className="size-4" icon={Alert02Icon} />
      </span>
    );
  }

  if (type === "info") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-primary">
        <HugeiconsIcon aria-hidden className="size-4" icon={InformationCircleIcon} />
      </span>
    );
  }

  if (type === "loading") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
      </span>
    );
  }

  return null;
};

const ToastList = () => {
  const { toasts } = Toast.useToastManager();

  return toasts.map((item) => <ToastItem key={item.id} toast={item} />);
};

const ToastItem = ({ toast: item }: { toast: Toast.Root.ToastObject }) => {
  const previousTypeRef = useRef(item.type);
  const previousUpdateKeyRef = useRef(item.updateKey ?? 0);
  const [shakeGeneration, setShakeGeneration] = useState(0);

  useLayoutEffect(() => {
    const updateKey = item.updateKey ?? 0;

    if (updateKey > previousUpdateKeyRef.current && item.type === previousTypeRef.current) {
      setShakeGeneration((generation) => generation + 1);
    }

    previousTypeRef.current = item.type;
    previousUpdateKeyRef.current = updateKey;
  }, [item.type, item.updateKey]);

  const shakeClass =
    shakeGeneration > 0
      ? shakeGeneration % 2 === 0
        ? "toast-shake-even"
        : "toast-shake-odd"
      : null;

  return (
    <Toast.Root
      className={cn(
        "absolute right-0 bottom-0 left-auto z-[calc(1000-var(--toast-index))] mr-0 h-(--height) w-full origin-bottom transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-lg outline-none select-none [--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))] [transition:transform_0.35s_cubic-bezier(0.22,1,0.36,1),opacity_0.25s_ease,height_0.15s_ease,scale_0.25s_cubic-bezier(0.22,1,0.36,1)] squircle after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-[''] data-ending-style:opacity-0 data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] motion-reduce:transition-none motion-reduce:data-starting-style:scale-100 [&[data-ending-style]:not([data-swipe-direction])]:scale-90 motion-reduce:[&[data-ending-style]:not([data-swipe-direction])]:scale-100",
        shakeClass,
      )}
      toast={item}
    >
      <Toast.Content className="flex items-start gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100">
        <ToastIcon type={item.type} />
        <div className="grid min-w-0 flex-1 gap-1 pr-6">
          {item.title ? <Toast.Title className="text-sm font-semibold text-current" /> : null}
          {item.description ? <Toast.Description className="text-sm text-current/75" /> : null}
        </div>
        <span className="absolute top-3 right-3">
          <IconButtonTooltip label="Dismiss">
            <Toast.Close
              aria-label="Dismiss"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-transform duration-100 ease-out outline-none squircle hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              <HugeiconsIcon aria-hidden className="size-3.5" icon={Cancel01Icon} />
            </Toast.Close>
          </IconButtonTooltip>
        </span>
      </Toast.Content>
    </Toast.Root>
  );
};

export const Toaster = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { children?: ReactNode }) => (
  <Toast.Provider limit={3} timeout={DEFAULT_TIMEOUT} toastManager={toastManager}>
    {children}
    <Toast.Portal>
      <Toast.Viewport
        className={cn(
          "fixed top-auto right-4 bottom-4 left-auto z-50 mx-auto w-[min(22.5rem,calc(100vw-2rem))] outline-none",
          className,
        )}
        {...props}
      >
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>
);
