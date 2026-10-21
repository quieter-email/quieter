import { toastError } from "@quieter/app/lib/error-toast";
import { cn } from "@quieter/ui/cn";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { router } from "./router";

export const DesktopShell = ({ children }: { children: ReactNode }) => {
  const headerRef = useRef<HTMLElement>(null);
  const isBrandedScreen = useRouterState({
    router,
    select: (state) =>
      state.location.pathname === "/auth" ||
      state.location.pathname === "/onboarding",
  });

  useEffect(() => {
    const header = headerRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const syncColors = async () => {
      if (!(header && context)) {
        return;
      }
      const style = getComputedStyle(header);
      const [background, foreground] = [style.backgroundColor, style.color].map(
        (color) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          return `#${[red, green, blue]
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")}`;
        }
      );
      try {
        await window.quieterDesktop.setTitleBarColors({
          background,
          foreground,
        });
      } catch (error) {
        toastError(error);
      }
    };
    const update = () => {
      void syncColors();
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributeFilter: ["class", "data-color-theme", "style"],
      attributes: true,
    });
    if (header) {
      observer.observe(header, {
        attributeFilter: ["class"],
        attributes: true,
      });
    }
    update();
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="desktop-shell bg-bg text-fg">
      <header
        aria-label="Window title bar"
        className={cn("desktop-title-bar bg-bg text-muted-fg", {
          dark: isBrandedScreen,
        })}
        ref={headerRef}
      />
      <div className="desktop-content">{children}</div>
    </div>
  );
};
