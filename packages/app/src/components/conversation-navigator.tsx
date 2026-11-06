"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { ThreadRail } from "@quieter/ui/thread-rail";
import type { ThreadRailItem } from "@quieter/ui/thread-rail";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

export type ConversationNavigationScope = {
  viewportRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  gutterRef: RefObject<HTMLElement | null>;
};

type ConversationNavigatorProps = {
  "aria-label": string;
  scope: ConversationNavigationScope;
  items: readonly ThreadRailItem[];
  enabled?: boolean;
  onNavigateStart?: () => void;
  prepareItem?: (id: string) => void | Promise<void>;
};

type NavigationGeometry =
  | { kind: "hidden" }
  | {
      kind: "visible";
      host: HTMLElement;
      activeId: string;
      maxHeight: number;
      itemIds: readonly string[];
    };

export const ConversationNavigator = ({
  "aria-label": label,
  enabled = true,
  items,
  onNavigateStart,
  prepareItem,
  scope,
}: ConversationNavigatorProps) => {
  const { contentRef, gutterRef, viewportRef } = scope;
  const [geometry, setGeometry] = useState<NavigationGeometry>({
    kind: "hidden",
  });
  const navigationRequest = useRef(0);
  const readItems = useEffectEvent(() => items);
  const itemIds = JSON.stringify(items.map((item) => item.id));

  useEffect((): (() => void) | undefined => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const host = gutterRef.current;
    const view = viewport?.ownerDocument.defaultView;
    if (
      !enabled ||
      viewport === null ||
      content === null ||
      host === null ||
      view === null ||
      view === undefined
    ) {
      setGeometry((current) =>
        current.kind === "hidden" ? current : { kind: "hidden" }
      );
      return undefined;
    }

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const anchors = new Map(
        [
          ...content.querySelectorAll<HTMLElement>("[data-conversation-item]"),
        ].map((element) => [element.dataset.conversationItem, element] as const)
      );
      const landmarks = readItems().flatMap((item) => {
        const element = anchors.get(item.id);
        return element === undefined ? [] : [{ element, item }];
      });
      const hostStyle = view.getComputedStyle(host);
      const maxHeight =
        viewport.clientHeight -
        Number(hostStyle.paddingTop.replace("px", "")) -
        Number(hostStyle.paddingBottom.replace("px", ""));
      const [first] = landmarks;
      if (
        first === undefined ||
        landmarks.length < 2 ||
        maxHeight <= 0 ||
        viewport.scrollHeight <= viewport.clientHeight + 1
      ) {
        setGeometry((current) =>
          current.kind === "hidden" ? current : { kind: "hidden" }
        );
        return;
      }

      const readingLine = viewport.getBoundingClientRect().top + 1;
      let activeId = first.item.id;
      for (const landmark of landmarks) {
        if (landmark.element.getBoundingClientRect().top > readingLine) {
          break;
        }
        activeId = landmark.item.id;
      }
      if (
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
        1
      ) {
        activeId = landmarks.at(-1)?.item.id ?? activeId;
      }

      const visibleIds = landmarks.map(({ item }) => item.id);
      setGeometry((current) =>
        current.kind === "visible" &&
        current.host === host &&
        current.activeId === activeId &&
        current.maxHeight === maxHeight &&
        current.itemIds.length === visibleIds.length &&
        current.itemIds.every((id, index) => id === visibleIds[index])
          ? current
          : {
              activeId,
              host,
              itemIds: visibleIds,
              kind: "visible",
              maxHeight,
            }
      );
    };
    const scheduleMeasure = () => {
      frame ??= view.requestAnimationFrame(measure);
    };
    const observer = new view.ResizeObserver(scheduleMeasure);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", scheduleMeasure, { passive: true });
    scheduleMeasure();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", scheduleMeasure);
      if (frame !== null) {
        view.cancelAnimationFrame(frame);
      }
      navigationRequest.current += 1;
    };
  }, [contentRef, enabled, gutterRef, itemIds, viewportRef]);

  const navigate = async (id: string) => {
    navigationRequest.current += 1;
    const request = navigationRequest.current;
    onNavigateStart?.();
    try {
      await prepareItem?.(id);
      if (request !== navigationRequest.current) {
        return;
      }
      const viewport = viewportRef.current;
      const content = contentRef.current;
      const view = viewport?.ownerDocument.defaultView;
      if (
        viewport === null ||
        content === null ||
        view === null ||
        view === undefined
      ) {
        return;
      }
      const anchor = [
        ...content.querySelectorAll<HTMLElement>("[data-conversation-item]"),
      ].find((element) => element.dataset.conversationItem === id);
      if (anchor === undefined || !anchor.isConnected) {
        return;
      }
      viewport.scrollTo({
        behavior: view.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        top:
          viewport.scrollTop +
          anchor.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top,
      });
    } catch (error) {
      if (request === navigationRequest.current) {
        toastError(error, { boundary: "conversation-navigation" });
      }
    }
  };

  if (geometry.kind === "hidden" || !enabled) {
    return null;
  }
  return createPortal(
    <ThreadRail
      activeId={geometry.activeId}
      aria-label={label}
      items={items.filter((item) => geometry.itemIds.includes(item.id))}
      maxHeight={geometry.maxHeight}
      onSelect={(id) => {
        void navigate(id);
      }}
    />,
    geometry.host
  );
};
