import { brand } from "@quieter/ui/brand-geometry";
import { cn } from "@quieter/ui/cn";
import type { ComponentPropsWithoutRef } from "react";

type LoadingSpinnerProps = ComponentPropsWithoutRef<"svg">;

const trailOpacities = [
  0.02, 0.03, 0.045, 0.06, 0.08, 0.105, 0.135, 0.17, 0.21, 0.255, 0.305, 0.36,
  0.42, 0.48, 0.545, 0.61, 0.675, 0.735, 0.79, 0.84, 0.885, 0.925, 0.96, 1,
];

export const LoadingSpinner = ({
  className,
  ...props
}: LoadingSpinnerProps) => (
  <svg
    {...props}
    aria-hidden="true"
    className={cn("size-20 overflow-visible text-primary", className)}
    fill="none"
    focusable="false"
    viewBox="0 0 1000 1000"
  >
    <path
      d={brand.mark.path}
      opacity="0.12"
      pathLength="100"
      stroke="currentColor"
      strokeWidth="22.5"
    />
    {trailOpacities.map((opacity, index) => (
      <path
        className="loading-spinner-segment"
        d={brand.mark.path}
        key={opacity}
        opacity={opacity}
        pathLength="100"
        stroke="currentColor"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="25"
        style={{ animationDelay: `${index * -12}ms` }}
      />
    ))}
  </svg>
);
