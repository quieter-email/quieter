import { Add01Icon, Cancel01Icon, Loading03Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { AnimatePresence, m } from "motion/react";

export type WaitlistIconState = "error" | "idle" | "loading" | "success";

const waitlistIcons: Record<WaitlistIconState, IconSvgElement> = {
  error: Cancel01Icon,
  idle: Add01Icon,
  loading: Loading03Icon,
  success: Tick01Icon,
};

export const WaitlistSubmitIcon = ({ state }: { state: WaitlistIconState }) => (
  <AnimatePresence initial={false} mode="popLayout">
    <m.span
      animate={{ opacity: 1, scale: 1 }}
      className="grid place-items-center will-change-[transform,opacity]"
      exit={{ opacity: 0, scale: 0.9 }}
      initial={{ opacity: 0.5, scale: 0.9 }}
      key={state}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <HugeiconsIcon
        aria-hidden
        className={state === "loading" ? "size-3.5 animate-spin" : "size-3.5"}
        icon={waitlistIcons[state]}
      />
    </m.span>
  </AnimatePresence>
);
