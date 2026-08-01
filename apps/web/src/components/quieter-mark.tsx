import { cn } from "@quieter/ui/cn";

/**
 * The Quieter mark: four concentric squircle rings that step up in opacity
 * toward the centre. Mirrors the dark-mode variant of /icon.svg.
 */
export const QuieterMark = ({ className }: { className?: string }) => (
  <svg
    aria-hidden
    className={cn("size-5 text-fg", className)}
    fill="none"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      height="21.8"
      opacity="0.34"
      rx="7"
      stroke="currentColor"
      strokeWidth="1.1"
      width="21.8"
      x="1.1"
      y="1.1"
    />
    <rect
      height="17.8"
      opacity="0.6"
      rx="5.8"
      stroke="currentColor"
      strokeWidth="1.1"
      width="17.8"
      x="3.1"
      y="3.1"
    />
    <rect
      height="13.8"
      opacity="0.85"
      rx="4.6"
      stroke="currentColor"
      strokeWidth="1.1"
      width="13.8"
      x="5.1"
      y="5.1"
    />
    <rect
      height="9.8"
      rx="3.4"
      stroke="currentColor"
      strokeWidth="1.1"
      width="9.8"
      x="7.1"
      y="7.1"
    />
  </svg>
);
