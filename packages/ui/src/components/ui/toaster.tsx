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
import { useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { DEFAULT_TOAST_TIMEOUT, toastManager } from "./toast";

const ToastIcon = ({ type }: { type: string | undefined }) => {
  if (type === "success") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-success">
        <HugeiconsIcon
          aria-hidden
          className="size-4"
          icon={CheckmarkCircle02Icon}
        />
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
        <HugeiconsIcon
          aria-hidden
          className="size-4"
          icon={InformationCircleIcon}
        />
      </span>
    );
  }

  if (type === "loading") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-fg">
        <HugeiconsIcon
          aria-hidden
          className="size-4 animate-spin"
          icon={Loading03Icon}
        />
      </span>
    );
  }

  return null;
};

const ToastItem = ({ toast: item }: { toast: Toast.Root.ToastObject }) => {
  const previousTypeRef = useRef(item.type);
  const previousUpdateKeyRef = useRef(item.updateKey ?? 0);
  const [shakeGeneration, setShakeGeneration] = useState(0);

  useLayoutEffect(() => {
    const updateKey = item.updateKey ?? 0;

    if (
      updateKey > previousUpdateKeyRef.current &&
      item.type === previousTypeRef.current
    ) {
      setShakeGeneration((generation) => generation + 1);
    }

    previousTypeRef.current = item.type;
    previousUpdateKeyRef.current = updateKey;
  }, [item.type, item.updateKey]);

  return (
    <Toast.Root
      className={cn(
        "squircle absolute right-0 bottom-0 left-auto z-[calc(1000-var(--toast-index))] mr-0 h-(--height) w-full origin-bottom transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] rounded-xl border border-border bg-popover text-popover-fg shadow-lg select-none [--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))] [transition:transform_0.35s_cubic-bezier(0.22,1,0.36,1),opacity_0.25s_ease,height_0.15s_ease,scale_0.25s_cubic-bezier(0.22,1,0.36,1)] after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-[''] data-ending-style:opacity-0 data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] motion-reduce:transition-none motion-reduce:data-starting-style:scale-100 [&[data-ending-style]:not([data-swipe-direction])]:scale-90 motion-reduce:[&[data-ending-style]:not([data-swipe-direction])]:scale-100",
        {
          "toast-shake-even": shakeGeneration > 0 && shakeGeneration % 2 === 0,
          "toast-shake-odd": shakeGeneration > 0 && shakeGeneration % 2 === 1,
        }
      )}
      toast={item}
    >
      <Toast.Content className="flex items-start gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100">
        <ToastIcon type={item.type} />
        <div className="grid min-w-0 flex-1 gap-1 pr-6">
          {item.title !== null &&
          item.title !== undefined &&
          item.title !== "" ? (
            <Toast.Title className="text-body font-semibold text-current" />
          ) : null}
          {item.description !== null &&
          item.description !== undefined &&
          item.description !== "" ? (
            <Toast.Description className="text-body text-current/75" />
          ) : null}
        </div>
        <Toast.Close
          aria-label="Dismiss"
          className="squircle absolute top-3 right-3 flex size-7 items-center justify-center rounded-md text-muted-fg transition-transform duration-100 ease-out hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <HugeiconsIcon aria-hidden className="size-3.5" icon={Cancel01Icon} />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  );
};

const ToastList = () => {
  const { toasts } = Toast.useToastManager();

  return toasts.map((item) => <ToastItem key={item.id} toast={item} />);
};

export const Toaster = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { children?: ReactNode }) => (
  <Toast.Provider
    limit={3}
    timeout={DEFAULT_TOAST_TIMEOUT}
    toastManager={toastManager}
  >
    {children}
    <Toast.Portal>
      <Toast.Viewport
        className={cn(
          "fixed top-auto right-4 bottom-4 left-auto z-50 mx-auto w-[min(22.5rem,calc(100vw-2rem))]",
          className
        )}
        {...props}
      >
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>
);
