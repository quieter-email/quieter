"use client";

import { useCreateStore, useSelector } from "@tanstack/react-store";
import { useLayoutEffect } from "react";
import type { RefObject } from "react";

export const useElementVisible = (ref: RefObject<HTMLElement | null>) => {
  const visibleStore = useCreateStore(false);

  useLayoutEffect((): (() => void) | undefined => {
    const element = ref.current;
    if (element === null) {
      visibleStore.setState(() => false);
      return undefined;
    }

    const updateVisibility = () => {
      const nextVisible = element.getClientRects().length > 0;
      visibleStore.setState((current) =>
        current === nextVisible ? current : nextVisible
      );
    };

    updateVisibility();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(updateVisibility);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, visibleStore]);

  return useSelector(visibleStore, (visible) => visible);
};
