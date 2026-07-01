"use client";

import { useRef, useState } from "react";

export const useSidebarNavHover = <T extends string, E extends HTMLElement = HTMLElement>(
  layoutIdPrefix: string,
) => {
  const navRef = useRef<E | null>(null);
  const [hoveredId, setHoveredId] = useState<T | null>(null);
  const [exitingId, setExitingId] = useState<T | null>(null);
  const [hoverEnter, setHoverEnter] = useState(false);
  const [hoverSession, setHoverSession] = useState(0);

  const setHover = (id: T) => {
    setHoverEnter(hoveredId === null);
    if (hoveredId === null) {
      setHoverSession((current) => current + 1);
    }
    setExitingId(null);
    setHoveredId(id);
  };

  const clearHover = () => {
    if (hoveredId !== null) {
      setExitingId(hoveredId);
    }
    setHoverEnter(false);
    setHoveredId(null);
  };

  const clearHoverIfLeavingNav = (nextTarget: EventTarget | null) => {
    if (!nextTarget || !navRef.current?.contains(nextTarget as Node)) {
      clearHover();
    }
  };

  return {
    clearHover,
    clearHoverIfLeavingNav,
    hoverEnter,
    hoverLayoutId: `${layoutIdPrefix}-${hoverSession}`,
    hoveredId,
    isHoverExiting: (id: T) => exitingId === id,
    isHovered: (id: T) => hoveredId === id,
    navRef,
    onHoverExitComplete: () => setExitingId(null),
    setHover,
  };
};
